-- Create the chemical_properties table
CREATE TABLE chemical_properties (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    volatility_level INTEGER NOT NULL, -- Scale of 1-10, higher means more volatile
    solubility_level INTEGER NOT NULL, -- Scale of 1-10, higher means more soluble in water
    description TEXT,
    hazard_type VARCHAR(50) NOT NULL, -- Category of hazard (gas, liquid, etc.)
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Add index for faster lookups
CREATE INDEX idx_chemical_properties_name ON chemical_properties(name);

-- Insert sample data
INSERT INTO chemical_properties (name, volatility_level, solubility_level, description, hazard_type)
VALUES 
    ('Ammonia Gas', 8, 9, 'Colorless gas with pungent odor. Highly water soluble. Irritant to eyes, skin, and respiratory system.', 'gas'),
    ('Chlorine Gas', 7, 6, 'Greenish-yellow gas with strong odor. Moderate water solubility. Severe respiratory irritant.', 'gas'),
    ('Crude Oil', 3, 1, 'Complex mixture of hydrocarbons. Low volatility and water solubility. Forms slicks on water.', 'liquid'),
    ('Benzene', 6, 2, 'Colorless liquid with sweet odor. Moderate volatility, low water solubility. Carcinogenic.', 'liquid'),
    ('Sulfur Dioxide', 5, 8, 'Colorless gas with strong odor. Moderate volatility, high water solubility. Respiratory irritant.', 'gas');

-- Create a view for easier querying
CREATE VIEW chemical_properties_view AS
SELECT id, name, volatility_level, solubility_level, description, hazard_type
FROM chemical_properties;


INSERT INTO chemical_properties (name, volatility_level, solubility_level, description, hazard_type)
VALUES 
    ('Hydrogen Sulfide', 8, 7, 'Colorless gas, smells like rotten eggs. Highly toxic, flammable. Respiratory irritant.', 'gas'),
    ('Carbon Monoxide', 9, 1, 'Colorless, odorless, tasteless gas. Highly toxic, flammable. Interferes with oxygen transport.', 'gas'),
    ('Methane', 10, 1, 'Colorless, odorless gas. Extremely flammable, primary component of natural gas. Asphyxiant.', 'gas'),
    ('Xylene', 5, 1, 'Colorless liquid, sweet odor. Moderate volatility, low solubility. Irritant, affects central nervous system.', 'liquid'),
    ('Formaldehyde', 7, 10, 'Colorless gas with pungent odor, often in solution (formalin). High solubility. Respiratory irritant, carcinogen.', 'gas'), 
    ('Lead Dust', 1, 1, 'Heavy metal particulate. Non-volatile, low solubility. Cumulative neurotoxin.', 'particulate'), -- Example of a particulate
    ('Mercury Vapor', 6, 1, 'Elemental mercury evaporates at room temp. Low solubility. Highly toxic, especially via inhalation.', 'gas'), -- Technically a vapor, classified as gas here
    ('Phenol', 4, 7, 'Colorless crystalline solid or liquid, distinctive odor. Moderate volatility, good solubility. Corrosive, toxic.', 'liquid/solid'); -- Can be solid or liquid
