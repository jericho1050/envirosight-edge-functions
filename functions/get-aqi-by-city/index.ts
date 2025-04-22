// File: supabase/functions/get-aqi-by-city/index.ts

import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { corsHeaders } from "../_shared/cors.ts"

// Define the expected structure for AQI stations (matching lib/types.ts)
interface AQIStation {
  id: string | number // WAQI uses number (uid)
  name: string
  latitude: number
  longitude: number
  value: number | string // WAQI AQI can be a number or "-"
  lastUpdated: string
}

// Define the structure of the relevant parts of the WAQI API response
interface WaqiCityData {
  aqi: number
  idx: number
  attributions: Array<{
    url: string
    name: string
  }>
  city: {
    geo: [number, number] // [latitude, longitude]
    name: string
    url: string
  }
  dominentpol: string
  iaqi: Record<string, { v: number }>
  time: {
    s: string // Time string format "YYYY-MM-DD HH:MM:SS"
    tz: string // Timezone
    v: number // Timestamp
  }
}

interface WaqiCityResponse {
  status: string
  data: WaqiCityData | string // Data or error message
}

Deno.serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders })
  }

  try {
    // 1. Get API Token from environment variables
    const waqiApiToken = Deno.env.get("WAQI_API_TOKEN")
    if (!waqiApiToken) {
      console.error("WAQI_API_TOKEN environment variable not set.")
      return new Response(JSON.stringify({ error: "Server configuration error: Missing API token." }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    // 2. Parse request body for city name
    const { city } = await req.json()
    if (!city) {
      return new Response(JSON.stringify({ error: "Missing city name in request body." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    // 3. Construct WAQI API URL for city
    const encodedCity = encodeURIComponent(city)
    const waqiUrl = `https://api.waqi.info/feed/${encodedCity}/?token=${waqiApiToken}`

    console.log(`Fetching from WAQI city API: ${waqiUrl.replace(waqiApiToken, "API_TOKEN_HIDDEN")}`)

    // 4. Fetch data from WAQI API
    const waqiResponse = await fetch(waqiUrl)

    if (!waqiResponse.ok) {
      const errorText = await waqiResponse.text()
      console.error(`WAQI City API error (${waqiResponse.status}): ${errorText}`)
      return new Response(JSON.stringify({ error: `Failed to fetch AQI data for city: ${errorText}` }), {
        status: waqiResponse.status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    const waqiData: WaqiCityResponse = await waqiResponse.json()

    // 5. Check WAQI API status and transform data
    if (waqiData.status !== "ok" || typeof waqiData.data === "string") {
      const errorMessage = typeof waqiData.data === "string" ? waqiData.data : "Unknown WAQI API error"
      console.error(`WAQI City API returned error: ${errorMessage}`)
      
      // If the city is not found, return an empty array rather than an error
      if (errorMessage.includes("Unknown station")) {
        return new Response(JSON.stringify([]), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 200,
        })
      }
      
      return new Response(JSON.stringify({ error: `WAQI API error: ${errorMessage}` }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    // 6. Transform to AQI Station format
    const cityData = waqiData.data as WaqiCityData
    
    // Format a single station from the city data
    const station: AQIStation = {
      id: cityData.idx,
      name: cityData.city.name,
      latitude: cityData.city.geo[0],
      longitude: cityData.city.geo[1],
      value: cityData.aqi,
      lastUpdated: cityData.time.s,
    }

    // Return as an array with one station
    const stations: AQIStation[] = [station]

    console.log(`Successfully fetched AQI data for city ${city}.`)

    // 7. Return transformed data (as an array to match the format of the bounds endpoint)
    return new Response(JSON.stringify(stations), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    })
  } catch (error) {
    console.error("Error processing AQI city request:", error)
    return new Response(JSON.stringify({ error: error.message || "Internal server error." }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })
  }
})

/* To invoke locally:

  1. Run `supabase start` (see: https://supabase.com/docs/reference/cli/supabase-start)
  2. Make an HTTP request:

  curl -i --location --request POST 'http://127.0.0.1:54321/functions/v1/get-aqi-by-city' \
    --header 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0' \
    --header 'Content-Type: application/json' \
    --data '{"name":"Functions"}'

*/
