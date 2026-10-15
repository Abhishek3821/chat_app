import { createContext, useContext } from 'react';

export const EmbedCapabilities = createContext(null);
const routeFeatures = {
  '/calls': 'calls', '/meetings': 'meetings', '/meet': 'meetings',
  '/status': 'status', '/groups': 'groups', '/communities': 'groups',
  '/broadcasts': 'chat',
};

export function useEmbedCapabilities() {
  const features = useContext(EmbedCapabilities);
  return {
    embedded: features !== null,
    enabled: (feature) => features === null || features.includes(feature),
    routeAllowed: (to) => {
      if (features === null) return true;
      if (['/admin', '/platform', '/developers', '/business', '/workspace'].includes(to)) return false;
      return !routeFeatures[to] || features.includes(routeFeatures[to]);
    },
  };
}
