// Follow this setup guide to integrate the Deno language server with your editor:
// https://deno.land/manual/getting_started/setup_your_environment
// This enables autocomplete, go to definition, etc.

// Setup type definitions for built-in Supabase Runtime APIs
import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { serve } from "https://deno.land/std@0.224.0/http/server.ts"
import { createClient } from "npm:@supabase/supabase-js@latest"
import { corsHeaders } from "../_shared/cors.ts"

// --- Interfaces (keep existing interfaces) ---
interface RequestParams {
  latitude: number
  longitude: number
  chemical_id: number
  // Optional stack parameters for plume rise calculation
  stackHeight?: number // meters
  stackDiameter?: number // meters
  exitVelocity?: number // m/s
  exitTemperatureOffset?: number // degrees C (difference from ambient)
}

interface WeatherData {
  windSpeed: number // Expected in m/s for calculations
  windDirection: number
  temperature: number
  humidity: number
  timestamp: string
}

interface ChemicalProperties {
  id: number
  name: string
  volatility_level: number // Assuming scale 1-10
  solubility_level: number
  description: string
  hazard_type: string
}

interface PredictionResult {
  type: string
  properties: {
    chemical: ChemicalProperties
    weather: WeatherData
    timestamp: string
    model_type: string // Add model type info
  }
  geometry: {
    type: string
    coordinates: number[][][] // [[[lon, lat], [lon, lat], ...]]
  }
}

// --- Constants ---
const EARTH_RADIUS_METERS = 6371000
const MAX_DOWNWIND_DISTANCE_METERS = 20000 // Increasing from 10km to 20km for larger plumes
const DISTANCE_STEP_METERS = 100 // Step size for calculation
const CONCENTRATION_THRESHOLD = 1e-7 // Reducing threshold from 1e-6 to 1e-7 to extend plume boundary
const MIN_SIGMA_Y = 1 // Minimum dispersion width to avoid division by zero
const MIN_SIGMA_Z = 1
const MPH_TO_MPS = 0.44704 // Conversion factor for wind speed

// Default stack parameters (used if not provided in request)
const DEFAULT_STACK_HEIGHT = 10 // meters
const DEFAULT_STACK_DIAMETER = 1 // meters
const DEFAULT_EXIT_VELOCITY = 10 // m/s
const DEFAULT_EXIT_TEMP_OFFSET = 20 // degrees C

// --- Gaussian Plume Calculation Helper Functions ---

/**
 * Estimates Pasquill stability class based on wind speed (m/s).
 * Very simplified: Assumes daytime, moderate solar radiation.
 */
function estimatePasquillStability(windSpeed: number): string {
  if (windSpeed < 2) return "A" // Very unstable
  if (windSpeed < 3) return "B" // Unstable
  if (windSpeed < 5) return "C" // Slightly unstable
  if (windSpeed < 6) return "D" // Neutral
  return "D" // Treat > 6 as Neutral for simplicity here (could be E/F at night)
}

/**
 * Calculates Pasquill-Gifford dispersion coefficients (sigma_y, sigma_z) in meters.
 * Uses power-law approximations for open country.
 * x: downwind distance in meters.
 */
function getDispersionCoefficients(stabilityClass: string, x_meters: number): { sigmaY: number; sigmaZ: number } {
  const x_km = x_meters / 1000 // Formulas often use km

  if (x_km <= 0) return { sigmaY: MIN_SIGMA_Y, sigmaZ: MIN_SIGMA_Z } // Avoid log(0) or x^0 issues

  let sigmaY = 0
  let sigmaZ = 0

  // Pasquill-Gifford Sigma Y (Open Country)
  const a_y = [0.22, 0.16, 0.11, 0.08, 0.06, 0.04]
  const b_y = [0.89, 0.89, 0.89, 0.89, 0.89, 0.89] // Simplified, often varies slightly

  // Pasquill-Gifford Sigma Z (Open Country - using common power laws)
  // Note: These vary significantly between sources. Using a common set.
  const a_z = [0.20, 0.12, 0.08, 0.06, 0.03, 0.016]
  const b_z = [1.0, 1.0, 0.7, 0.7, 0.7, 0.7] // Simplified exponents

  const classIndex = stabilityClass.charCodeAt(0) - "A".charCodeAt(0)

  if (classIndex >= 0 && classIndex < a_y.length) {
    sigmaY = a_y[classIndex] * Math.pow(x_km, b_y[classIndex]) * 1000 // Convert back to meters
    sigmaZ = a_z[classIndex] * Math.pow(x_km, b_z[classIndex]) * 1000 // Convert back to meters
  } else { // Default to Neutral (D) if class is invalid
    sigmaY = a_y[3] * Math.pow(x_km, b_y[3]) * 1000
    sigmaZ = a_z[3] * Math.pow(x_km, b_z[3]) * 1000
  }

  // Ensure minimum values to prevent division by zero
  sigmaY = Math.max(sigmaY, MIN_SIGMA_Y)
  sigmaZ = Math.max(sigmaZ, MIN_SIGMA_Z)

  return { sigmaY, sigmaZ }
}

/**
 * Converts distance offsets (meters) to delta latitude/longitude.
 */
function metersToDeltaLonLat(dx_meters: number, dy_meters: number, latitude: number): { deltaLon: number; deltaLat: number } {
  const latRadians = latitude * (Math.PI / 180)
  const deltaLat = dy_meters / EARTH_RADIUS_METERS * (180 / Math.PI)
  const deltaLon = dx_meters / (EARTH_RADIUS_METERS * Math.cos(latRadians)) * (180 / Math.PI)
  return { deltaLon, deltaLat }
}

/**
 * Calculates plume rise using simplified Briggs formulas.
 * NOTE: This is a simplified implementation. Full Briggs equations are more complex.
 * Requires wind speed in m/s.
 */
function calculateBriggsPlumeRise(
    stackDiameter: number,
    exitVelocity: number,
    exitTemperatureKelvin: number,
    ambientTemperatureKelvin: number,
    windSpeed: number, // Should ideally be wind speed at stack height
    stabilityClass: string
): number {
    console.log("Calculating plume rise with:", { stackDiameter, exitVelocity, exitTemperatureKelvin, ambientTemperatureKelvin, windSpeed, stabilityClass });

    const g = 9.81; // m/s^2
    const windSpeedAtStack = Math.max(windSpeed, 0.1); // Use ground level wind as approximation, ensure not zero

    // Calculate Buoyancy Flux Parameter (F)
    const buoyancyFluxF = g * exitVelocity * Math.pow(stackDiameter / 2, 2) * (1 - ambientTemperatureKelvin / exitTemperatureKelvin);

    let deltaH = 0;

    // --- Simplified Briggs Formulas ---
    // Reference: EPA AERMOD Technical Documentation often cites these forms.

    if (buoyancyFluxF <= 0) {
        // Neutral or negative buoyancy (dense gas) - Plume rise is complex, often negative.
        // For simplicity, assume momentum-driven rise only or zero rise if momentum is low.
        // Using a simplified momentum rise formula for neutral/unstable:
        // deltaH = 3 * stackDiameter * (exitVelocity / windSpeedAtStack);
        // For now, returning 0 for non-buoyant cases for simplicity.
        console.warn("Non-buoyant plume (F <= 0), returning 0 plume rise.");
        deltaH = 0;
    } else if (stabilityClass <= 'D') { // Unstable / Neutral Conditions (A, B, C, D)
        // Buoyancy dominated rise
        if (buoyancyFluxF >= 55) { // Large buoyancy
            deltaH = 38.71 * Math.pow(buoyancyFluxF, 3/5) / windSpeedAtStack;
        } else { // Smaller buoyancy
            deltaH = 21.425 * Math.pow(buoyancyFluxF, 3/4) / windSpeedAtStack;
        }
        // Amplify the plume rise to make visual effect more dramatic
        deltaH = deltaH * 1.5; // Amplification factor
        // Could add momentum dominance check here if needed
    } else { // Stable Conditions (E, F)
        // Buoyancy rise in stable conditions
        // Requires stability parameter 's' = (g / Ta) * (dTheta/dz)
        // Estimating 's' is complex. Using typical values: s ~ 0.0005 for E, s ~ 0.0015 for F
        const stabilityParam_s = (stabilityClass === 'E') ? 0.0005 : 0.0015; // Rough estimate
        deltaH = 2.6 * Math.pow(buoyancyFluxF / (windSpeedAtStack * stabilityParam_s), 1/3);
        // Amplify the plume rise to make visual effect more dramatic
        deltaH = deltaH * 1.5; // Amplification factor
    }

    console.log("Calculated deltaH:", deltaH);
    return Math.max(0, deltaH); // Ensure plume rise is not negative
}

/**
 * Calculates dispersion polygon using a simplified Gaussian Plume model with plume rise.
 */
function calculateGaussianPlumePolygon(
  latitude: number,
  longitude: number,
  weather: WeatherData, // Expects windSpeed in m/s
  chemical: ChemicalProperties,
  // Accept stack parameters as arguments
  stackHeight: number,
  stackDiameter: number,
  exitVelocity: number,
  exitTempOffset: number
): number[][] {
  const points: number[][] = []
  const stabilityClass = estimatePasquillStability(weather.windSpeed)
  // Estimate emission rate (Q) based on volatility and stack parameters for more dramatic effect
  // This is a visual enhancement - not scientifically accurate but provides better visualization
  const emissionFactor = Math.max(1, stackHeight / 10) * Math.max(1, stackDiameter)
  const Q = (chemical.volatility_level || 1) * emissionFactor
  console.log(`Calculated emission rate Q: ${Q} (volatility: ${chemical.volatility_level}, emissionFactor: ${emissionFactor})`)
  
  const windAngleRadians = ((270 - weather.windDirection) % 360) * (Math.PI / 180)
  const cosWind = Math.cos(windAngleRadians)
  const sinWind = Math.sin(windAngleRadians)

  // --- Plume Rise Calculation (using provided parameters) ---
  // Convert temperatures for calculation
  // Ensure weather.temperature is in Celsius if needed (OpenWeather default is F for imperial)
  // Assuming weather.temperature is Fahrenheit from get-weather-data
  const ambientTempCelsius = (weather.temperature - 32) * 5 / 9;
  const exitTemperatureKelvin = (ambientTempCelsius + exitTempOffset) + 273.15
  const ambientTemperatureKelvin = ambientTempCelsius + 273.15

  // Validate inputs for plume rise
  if (isNaN(stackDiameter) || isNaN(exitVelocity) || isNaN(exitTemperatureKelvin) || isNaN(ambientTemperatureKelvin) || isNaN(weather.windSpeed)) {
      console.error("Invalid input to calculateBriggsPlumeRise:", { stackDiameter, exitVelocity, exitTemperatureKelvin, ambientTemperatureKelvin, windSpeed: weather.windSpeed });
      throw new Error("Invalid numeric input for plume rise calculation.");
  }


  const plumeRiseDeltaH = calculateBriggsPlumeRise(
      stackDiameter,
      exitVelocity,
      exitTemperatureKelvin,
      ambientTemperatureKelvin,
      weather.windSpeed, // Already converted to m/s
      stabilityClass
  )
  const effectiveHeightH = stackHeight + plumeRiseDeltaH
  console.log(`Stack Height: ${stackHeight}m, Plume Rise (deltaH): ${plumeRiseDeltaH.toFixed(2)}m, Effective Height (H): ${effectiveHeightH.toFixed(2)}m`);
  // --- End Plume Rise Calculation ---

  const plumePointsRight: { x: number; y: number }[] = []
  const plumePointsLeft: { x: number; y: number }[] = []
  let maxDistanceReached = 0

  // Calculate points along the plume edge
  for (let x = 0; x <= MAX_DOWNWIND_DISTANCE_METERS; x += DISTANCE_STEP_METERS) {
    const { sigmaY, sigmaZ } = getDispersionCoefficients(stabilityClass, x)

    // --- Modified Concentration Calculation (using effectiveHeightH) ---
    const concentrationFactor = Q / (Math.PI * sigmaY * sigmaZ * Math.max(weather.windSpeed, 0.1))
    const heightFactor = sigmaZ > 0 ? Math.exp(-(effectiveHeightH * effectiveHeightH) / (2 * sigmaZ * sigmaZ)) : 0;
    const centerlineConcentration = concentrationFactor * heightFactor
    // --- End Modified Concentration ---

    if (centerlineConcentration < CONCENTRATION_THRESHOLD && x > 0) {
      maxDistanceReached = x - DISTANCE_STEP_METERS
      break
    }
    maxDistanceReached = x

    const plumeHalfWidth = sigmaY * 3.0 // Increased from 2.15 to 3.0 for wider plume visualization

    plumePointsRight.push({ x: x, y: plumeHalfWidth })
    plumePointsLeft.push({ x: x, y: -plumeHalfWidth })
  }

  // --- Polygon Point Generation --- 
  points.push([longitude, latitude]) // Start at source
  for (const p of plumePointsRight) { // Add right edge
    const rotatedX = p.x * cosWind - p.y * sinWind
    const rotatedY = p.x * sinWind + p.y * cosWind
    const { deltaLon, deltaLat } = metersToDeltaLonLat(rotatedX, rotatedY, latitude)
    points.push([longitude + deltaLon, latitude + deltaLat])
  }
  for (let i = plumePointsLeft.length - 1; i >= 0; i--) { // Add left edge (reversed)
    const p = plumePointsLeft[i]
    const rotatedX = p.x * cosWind - p.y * sinWind
    const rotatedY = p.x * sinWind + p.y * cosWind
    const { deltaLon, deltaLat } = metersToDeltaLonLat(rotatedX, rotatedY, latitude)
    points.push([longitude + deltaLon, latitude + deltaLat])
  }
  points.push([longitude, latitude]) // Close polygon
  // --- End Polygon Point Generation ---

  // Basic validation
  if (points.length < 4) {
    console.warn("Generated polygon has less than 4 points, returning small default shape.")
    const { deltaLon: dLon, deltaLat: dLat } = metersToDeltaLonLat(10, 10, latitude)
    return [
      [longitude, latitude],
      [longitude + dLon, latitude],
      [longitude, latitude + dLat],
      [longitude, latitude],
    ]
  }
  return points
}


// --- Main Serve Function ---
serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders })
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") || ""
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || ""

    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error("SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is not set")
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    // Parse request body - Remove optional stack parameters from destructuring
    const {
      latitude,
      longitude,
      chemical_id,
      // stackHeight = DEFAULT_STACK_HEIGHT, // <-- Removed
      // stackDiameter = DEFAULT_STACK_DIAMETER, // <-- Removed
      // exitVelocity = DEFAULT_EXIT_VELOCITY, // <-- Removed
      // exitTemperatureOffset = DEFAULT_EXIT_TEMP_OFFSET // <-- Removed
    } = await req.json() as RequestParams // Keep type assertion for required params

    // Validate required parameters
    if (
      latitude === undefined || longitude === undefined || chemical_id === undefined ||
      isNaN(latitude) || isNaN(longitude) || isNaN(chemical_id)
    ) {
      return new Response(
        JSON.stringify({ error: "Invalid parameters. Latitude, longitude, and chemical_id are required and must be numbers." }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      )
    }
     // Removed validation for optional stack parameters
     // if ((stackHeight !== undefined && isNaN(stackHeight)) || ... ) { ... }


    // Fetch chemical properties
    const { data: chemical, error: chemicalError } = await supabase
      .from("chemical_properties")
      .select("*")
      .eq("id", chemical_id)
      .single<ChemicalProperties>()

    if (chemicalError || !chemical) {
      console.error("Error fetching chemical properties:", chemicalError)
      throw new Error(`Chemical with ID ${chemical_id} not found or error fetching: ${chemicalError?.message}`)
    }

    // Fetch weather data
    const weatherResponse = await fetch(
      `${supabaseUrl}/functions/v1/get-weather-data`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${supabaseServiceKey}`,
        },
        body: JSON.stringify({ lat: latitude, lon: longitude }),
      }
    )

    if (!weatherResponse.ok) {
      const errorText = await weatherResponse.text()
      console.error(`Weather API error: ${weatherResponse.status} - ${errorText}`)
      throw new Error(`Failed to fetch weather data: ${weatherResponse.status}`)
    }

    let weatherData: WeatherData = await weatherResponse.json()

    console.log(`Original wind speed (mph): ${weatherData.windSpeed}`);
    weatherData.windSpeed = weatherData.windSpeed * MPH_TO_MPS;
    console.log(`Converted wind speed (m/s): ${weatherData.windSpeed.toFixed(2)}`);

    // --- Calculate dispersion using Gaussian Plume Model with Plume Rise ---
    // Always use default stack parameters now
    const dispersionPolygon = calculateGaussianPlumePolygon(
      latitude,
      longitude,
      weatherData,
      chemical,
      DEFAULT_STACK_HEIGHT,
      DEFAULT_STACK_DIAMETER,
      DEFAULT_EXIT_VELOCITY,
      DEFAULT_EXIT_TEMP_OFFSET
    )

    const result: PredictionResult = {
      type: "Feature",
      properties: {
        chemical,
        weather: weatherData,
        timestamp: new Date().toISOString(),
        model_type: "Simplified Gaussian Plume with Briggs Plume Rise",
      },
      geometry: {
        type: "Polygon",
        coordinates: [dispersionPolygon],
      },
    }

    return new Response(
      JSON.stringify(result),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    )
  } catch (error) {
    console.error("Error running dispersion prediction:", error)
    return new Response(
      JSON.stringify({ error: "Failed to run dispersion prediction", details: error.message }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    )
  }
})

/* To invoke locally:

  1. Run `supabase start`
  2. Make sure `get-weather-data` function is also running/deployed locally.
  3. Update the Authorization Bearer token below with a valid one from `supabase status` (anon key).
  4. Make an HTTP request:

  # Basic request (uses default stack parameters)
  curl -i --location --request POST 'http://127.0.0.1:54321/functions/v1/run-dispersion-prediction' \\
    --header 'Authorization: Bearer YOUR_SUPABASE_ANON_KEY' \\
    --header 'Content-Type: application/json' \\
    --data '{
      "latitude": 39.8283,
      "longitude": -98.5795,
      "chemical_id": 1
    }'

  # Request with optional stack parameters
  curl -i --location --request POST 'http://127.0.0.1:54321/functions/v1/run-dispersion-prediction' \\
    --header 'Authorization: Bearer YOUR_SUPABASE_ANON_KEY' \\
    --header 'Content-Type: application/json' \\
    --data '{
      "latitude": 39.8283,
      "longitude": -98.5795,
      "chemical_id": 1,
      "stackHeight": 20,
      "stackDiameter": 0.5,
      "exitVelocity": 15,
      "exitTemperatureOffset": 30
    }'

*/
