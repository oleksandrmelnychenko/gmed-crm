UPDATE providers provider
SET taxonomy_attributes = jsonb_set(COALESCE(provider.taxonomy_attributes, '{}'::jsonb), '{hotel_breakfast_terms}', $2::jsonb, true),
    updated_at = now()
WHERE provider.id = $1 AND provider.provider_type = 'non_medical'
    AND EXISTS (SELECT 1 FROM provider_taxonomy_assignments assignment
        JOIN provider_taxonomy_nodes taxonomy ON taxonomy.id = assignment.taxonomy_node_id
        WHERE assignment.provider_id = provider.id AND taxonomy.code = 'nonmedical_hotels')
RETURNING taxonomy_attributes->'hotel_breakfast_terms'
