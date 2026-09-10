SELECT jsonb_build_object(
    'id', provider.id, 'name', provider.name,
    'city', provider.address_city, 'country', provider.address_country
) AS item
FROM providers provider
WHERE provider.is_active AND provider.provider_type = 'non_medical'
    AND EXISTS (
        SELECT 1 FROM provider_taxonomy_assignments assignment
        JOIN provider_taxonomy_nodes taxonomy ON taxonomy.id = assignment.taxonomy_node_id
        WHERE assignment.provider_id = provider.id AND taxonomy.code = 'nonmedical_hotels'
    )
ORDER BY provider.name, provider.id
