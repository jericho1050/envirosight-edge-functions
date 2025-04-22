// File: supabase/functions/get-hazard-sites/index.ts (Conceptual Example)

import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { corsHeaders } from "../_shared/cors.ts"

// Define the expected structure for Hazard Sites (matching lib/types.ts)
interface HazardSite {
  id: string | number // OSM uses number
  name: string
  type: string // e.g., 'Industrial', 'Power Plant', 'Landfill'
  latitude: number
  longitude: number
  description: string
}

// Define the structure of the relevant parts of the Overpass API response
interface OverpassElement {
  type: "node" | "way" | "relation"
  id: number
  lat?: number // Only for nodes
  lon?: number // Only for nodes
  center?: { // Only for ways/relations if using 'out center;'
    lat: number
    lon: number
  }
  tags?: {
    name?: string
    industrial?: string
    landuse?: string
    amenity?: string
    man_made?: string
    power?: string
    // Add other relevant tag keys here
    [key: string]: string | undefined
  }
}

interface OverpassResponse {
  elements: OverpassElement[]
}

// URL for a public Overpass API instance
const OVERPASS_API_URL = "https://overpass-api.de/api/interpreter"
// const OVERPASS_API_URL = "https://lz4.overpass-api.de/api/interpreter"; // Alternative instance

Deno.serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders })
  }

  try {
    // 1. Parse request body for bounds
    const { north, south, east, west } = await req.json()
    if (north === undefined || south === undefined || east === undefined || west === undefined) {
      return new Response(JSON.stringify({ error: "Missing map bounds in request body." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    // 2. Construct Overpass QL query
    // Format: south,west,north,east
    const bbox = `${south},${west},${north},${east}`
    // --- START MODIFYING HERE ---
    const query = `
      [out:json][timeout:25]; // Adjust timeout if needed
      (
        // --- Add or remove OSM features/tags below ---
        node["industrial"="factory"](${bbox});
        way["industrial"="factory"](${bbox});
        node["landuse"="industrial"](${bbox});
        way["landuse"="industrial"](${bbox});
        node["amenity"="fuel"](${bbox}); // Fuel depots/stations
        way["amenity"="fuel"](${bbox});
        node["man_made"="storage_tank"](${bbox});
        way["man_made"="storage_tank"](${bbox});
        node["power"="plant"](${bbox});
        way["power"="plant"](${bbox});
        node["landuse"="landfill"](${bbox});
        way["landuse"="landfill"](${bbox});
        node["landuse"="quarry"](${bbox});
        way["landuse"="quarry"](${bbox});
        node["man_made"="wastewater_plant"](${bbox});
        way["man_made"="wastewater_plant"](${bbox});
        node["power"="substation"](${bbox});
        way["power"="substation"](${bbox});
        // Example: Add chemical plants specifically
        // node["industrial"="chemical"](${bbox});
        // way["industrial"="chemical"](${bbox});
        // Example: Add pipelines (Note: 'out center;' is important for ways)
        // node["man_made"="pipeline"](${bbox});
        // way["man_made"="pipeline"](${bbox});
        // --- End of features/tags ---
      );
      // Use 'out center;' to get coordinates for ways/relations
      // Use 'out geom;' if you need the full geometry (more complex)
      out center;
    `
    // --- END MODIFYING HERE ---

    console.log(`Fetching from Overpass with bbox: ${bbox}`)
    // console.log(`Overpass Query: ${query}`); // Uncomment to debug the query

    // 3. Fetch data from Overpass API
    const overpassResponse = await fetch(OVERPASS_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: `data=${encodeURIComponent(query)}`,
    })

    if (!overpassResponse.ok) {
      const errorText = await overpassResponse.text()
      console.error(`Overpass API error (${overpassResponse.status}): ${errorText}`)
      // Provide more specific error if timeout likely occurred
      if (overpassResponse.status === 429 || overpassResponse.status === 504) {
         return new Response(JSON.stringify({ error: `Overpass API request timed out or rate limited. Try zooming in or simplifying the query.` }), {
             status: overpassResponse.status,
             headers: { ...corsHeaders, "Content-Type": "application/json" },
         })
      }
      return new Response(JSON.stringify({ error: `Failed to fetch hazard sites from Overpass: ${errorText}` }), {
        status: overpassResponse.status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    const overpassData: OverpassResponse = await overpassResponse.json()

    // 4. Transform Overpass data to HazardSite format
    const hazardSites: HazardSite[] = overpassData.elements.map((element) => {
      // Get coordinates (prefer node coords, fallback to center for ways/relations)
      const lat = element.lat ?? element.center?.lat ?? 0
      const lon = element.lon ?? element.center?.lon ?? 0
      const name = element.tags?.name ?? "Unnamed Site"

      // --- START MODIFYING TYPE/DESCRIPTION LOGIC ---
      // Determine type and description based on tags
      let type = "Unknown Hazard"
      let description = `OSM Feature: ${name}`

      if (element.tags?.industrial) {
        type = `Industrial (${element.tags.industrial})`
        description = `Industrial facility: ${name}`
      } else if (element.tags?.landuse === "industrial") {
        type = "Industrial Area"
        description = `Industrial land use area: ${name}`
      } else if (element.tags?.amenity === "fuel") {
        type = "Fuel Station/Depot"
        description = `Fuel storage/sales: ${name}`
      } else if (element.tags?.man_made === "storage_tank") {
        type = "Storage Tank"
        description = `Storage tank: ${name}`
      } else if (element.tags?.power === "plant") {
        type = "Power Plant"
        description = `Power generation plant: ${name}`
      } else if (element.tags?.landuse === "landfill") {
        type = "Landfill"
        description = `Waste disposal site: ${name}`
      } else if (element.tags?.landuse === "quarry") {
        type = "Quarry"
        description = `Extraction site: ${name}`
      } else if (element.tags?.man_made === "wastewater_plant") {
        type = "Wastewater Plant"
        description = `Wastewater treatment facility: ${name}`
      } else if (element.tags?.power === "substation") {
        type = "Power Substation"
        description = `Electrical substation: ${name}`
      }
      // Add more 'else if' blocks here for any new tags you added to the query
      // --- END MODIFYING TYPE/DESCRIPTION LOGIC ---

      return {
        id: element.id,
        name: name,
        type: type,
        latitude: lat,
        longitude: lon,
        description: description,
      }
    }).filter(site => site.latitude !== 0 && site.longitude !== 0); // Filter out elements where coords couldn't be determined

    console.log(`Successfully fetched and transformed ${hazardSites.length} hazard sites.`)

    // 5. Return transformed data
    return new Response(JSON.stringify(hazardSites), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    })
  } catch (error) {
    console.error("Error processing hazard sites request:", error)
    return new Response(JSON.stringify({ error: error.message || "Internal server error." }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })
  }
})