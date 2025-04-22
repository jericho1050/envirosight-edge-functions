// Follow this setup guide to integrate the Deno language server with your editor:
// https://deno.land/manual/getting_started/setup_your_environment
// This enables autocomplete, go to definition, etc.

// Setup type definitions for built-in Supabase Runtime APIs
import "jsr:@supabase/functions-js/edge-runtime.d.ts"

import { serve } from "https://deno.land/std@0.224.0/http/server.ts"
import { corsHeaders } from "../_shared/cors.ts"

interface RequestParams {
  lat: number
  lon: number
}

interface WeatherResponse {
  windSpeed: number
  windDirection: number
  temperature: number
  humidity: number
  timestamp: string
}

serve(async (req: Request) => {
  // Handle CORS preflight requests
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders })
  }

  try {
    // Get API key from environment variables
    const OPENWEATHER_API_KEY = Deno.env.get("OPENWEATHER_API_KEY")
    if (!OPENWEATHER_API_KEY) {
      throw new Error("OPENWEATHER_API_KEY is not set in environment variables")
    }

    // Parse request body
    const { lat, lon } = await req.json() as RequestParams

    // Validate input
    if (lat === undefined || lon === undefined || isNaN(lat) || isNaN(lon)) {
      return new Response(
        JSON.stringify({ error: "Invalid parameters. Latitude and longitude are required." }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      )
    }

    // Call OpenWeatherMap API
    const url = `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&units=imperial&appid=${OPENWEATHER_API_KEY}`
    
    const response = await fetch(url)
    
    if (!response.ok) {
      const errorText = await response.text()
      console.error(`OpenWeatherMap API error: ${response.status} - ${errorText}`)
      throw new Error(`Weather API error: ${response.status}`)
    }

    const data = await response.json()

    // Extract relevant weather data
    const weatherResponse: WeatherResponse = {
      windSpeed: data.wind?.speed || 0, // Wind speed in mph (imperial units)
      windDirection: data.wind?.deg || 0, // Wind direction in degrees (meteorological)
      temperature: data.main?.temp || 0, // Temperature in Fahrenheit (imperial units)
      humidity: data.main?.humidity || 0, // Humidity in %
      timestamp: new Date().toISOString(),
    }

    // Return the weather data
    return new Response(
      JSON.stringify(weatherResponse),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    )
  } catch (error) {
    console.error("Error fetching weather data:", error.message)
    
    return new Response(
      JSON.stringify({ error: "Failed to fetch weather data", details: error.message }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    )
  }
})

/* To invoke locally:

  1. Run `supabase start` (see: https://supabase.com/docs/reference/cli/supabase-start)
  2. Make an HTTP request:

  curl -i --location --request POST 'http://127.0.0.1:54321/functions/v1/get-weather-data' \
    --header 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ10.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0' \
    --header 'Content-Type: application/json' \
    --data '{"name":"Functions"}'

*/
