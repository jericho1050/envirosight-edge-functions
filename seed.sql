-- supabase/seed.sql

-- Insert the data 
-- Make sure IDs are integers if the column type is integer
INSERT INTO "public"."chemical_properties" ("id", "name", "volatility_level", "solubility_level", "description", "hazard_type", "created_at") VALUES 
(1, 'Ammonia Gas', 8, 9, 'Colorless gas with pungent odor. Highly water soluble. Irritant to eyes, skin, and respiratory system.', 'gas', '2025-04-13 00:01:41.560768+00'), 
(2, 'Chlorine Gas', 7, 6, 'Greenish-yellow gas with strong odor. Moderate water solubility. Severe respiratory irritant.', 'gas', '2025-04-13 00:01:41.560768+00'), 
(3, 'Crude Oil', 3, 1, 'Complex mixture of hydrocarbons. Low volatility and water solubility. Forms slicks on water.', 'liquid', '2025-04-13 00:01:41.560768+00'), 
(4, 'Benzene', 6, 2, 'Colorless liquid with sweet odor. Moderate volatility, low water solubility. Carcinogenic.', 'liquid', '2025-04-13 00:01:41.560768+00'), 
(5, 'Sulfur Dioxide', 5, 8, 'Colorless gas with strong odor. Moderate volatility, high water solubility. Respiratory irritant.', 'gas', '2025-04-13 00:01:41.560768+00')
-- Add ON CONFLICT DO NOTHING or similar if you might run the seed multiple times
-- and want to avoid errors on duplicate IDs
ON CONFLICT (id) DO NOTHING;
