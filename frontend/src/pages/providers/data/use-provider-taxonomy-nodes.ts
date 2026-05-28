import { useEffect, useState } from "react";

import { fetchProviderTaxonomy } from "./provider-api";
import type { ProviderTaxonomyNode, ProviderType } from "../model/types";

export function useProviderTaxonomyNodes(providerType?: ProviderType) {
  const [taxonomyNodes, setTaxonomyNodes] = useState<ProviderTaxonomyNode[]>([]);

  useEffect(() => {
    let active = true;
    fetchProviderTaxonomy(providerType)
      .then((taxonomy) => {
        if (active) setTaxonomyNodes(taxonomy.nodes.filter((node) => node.is_active));
      })
      .catch(() => {
        if (active) setTaxonomyNodes([]);
      });

    return () => {
      active = false;
    };
  }, [providerType]);

  return taxonomyNodes;
}
