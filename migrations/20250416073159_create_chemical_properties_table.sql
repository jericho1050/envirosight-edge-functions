-- Migration file: supabase/migrations/<timestamp>_create_chemical_properties_table.sql

CREATE TABLE public.chemical_properties (
    id integer PRIMARY KEY, 
    name text,
    volatility_level integer,
    solubility_level integer,
    description text,
    hazard_type text,
    created_at timestamp with time zone DEFAULT now()
);