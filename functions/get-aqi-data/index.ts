// Follow this setup guide to integrate the Deno language server with your editor:
// https://deno.land/manual/getting_started/setup_your_environment
// This enables autocomplete, go to definition, etc.

// Setup type definitions for built-in Supabase Runtime APIs
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
interface WaqiStation {
  lat: number
  lon: number
  uid: number
  aqi: string | number // AQI value, can be "-" if not available
  station: {
    name: string
    time?: string // Optional: Sometimes included, not the main time source
  }
  time: {
    stime: string // Station time string
    vtime: number // Epoch time
  }
}

interface WaqiResponse {
  status: string
  data: WaqiStation[] | { msg: string } // Data can be an array or an error message object
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

    // 2. Parse request body for bounds
    const { north, south, east, west } = await req.json()
    if (north === undefined || south === undefined || east === undefined || west === undefined) {
      return new Response(JSON.stringify({ error: "Missing map bounds in request body." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    // 3. Construct WAQI API URL
    // WAQI uses lat1,lng1,lat2,lng2 format for bounding box
    const latLngBounds = `${south},${west},${north},${east}`
    const waqiUrl = `https://api.waqi.info/map/bounds/?latlng=${latLngBounds}&token=${waqiApiToken}`

    console.log(`Fetching from WAQI: ${waqiUrl}`)

    // 4. Fetch data from WAQI API
    const waqiResponse = await fetch(waqiUrl)

    if (!waqiResponse.ok) {
      const errorText = await waqiResponse.text()
      console.error(`WAQI API error (${waqiResponse.status}): ${errorText}`)
      return new Response(JSON.stringify({ error: `Failed to fetch AQI data: ${errorText}` }), {
        status: waqiResponse.status, // Forward the status
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    const waqiData: WaqiResponse = await waqiResponse.json()

    // 5. Check WAQI API status and transform data
    if (waqiData.status !== "ok") {
      const errorMessage = (waqiData.data as { msg: string })?.msg || "Unknown WAQI API error"
      console.error(`WAQI API returned error: ${errorMessage}`)
      return new Response(JSON.stringify({ error: `WAQI API error: ${errorMessage}` }), {
        status: 400, // Or appropriate status based on WAQI error
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    // Ensure data is an array before proceeding
    if (!Array.isArray(waqiData.data)) {
         console.error("WAQI API returned unexpected data format:", waqiData.data)
         return new Response(JSON.stringify({ error: "Received unexpected data format from AQI provider." }), {
             status: 500,
             headers: { ...corsHeaders, "Content-Type": "application/json" },
         })
     }

    const stations: AQIStation[] = (waqiData.data as WaqiStation[]).map((station) => ({
      id: station.uid,
      name: station.station.name,
      latitude: station.lat,
      longitude: station.lon,
      // Handle cases where AQI might be "-" or invalid
      value: typeof station.aqi === 'number' ? station.aqi : (parseInt(station.aqi, 10) || 0),
      // Safely access time.stime, provide default if time is missing
      lastUpdated: station.time?.stime || "",
    }))

    console.log(`Successfully fetched and transformed ${stations.length} AQI stations.`)

    // 6. Return transformed data
    return new Response(JSON.stringify(stations), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    })
  } catch (error) {
    console.error("Error processing AQI request:", error)
    return new Response(JSON.stringify({ error: error.message || "Internal server error." }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })
  }
})

/* To invoke locally:

  1. Run `supabase start` (see: https://supabase.com/docs/reference/cli/supabase-start)
  2. Make an HTTP request:

  curl -i --location --request POST 'http://127.0.0.1:54321/functions/v1/get-aqi-data' \
    --header 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0' \
    --header 'Content-Type: application/json' \
    --data '{"name":"Functions"}'

*/
