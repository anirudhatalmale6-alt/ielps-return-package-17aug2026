'use strict';
module.exports = {
  currentSubscription: async () => ({ tier: 'free', status: 'active' }),
  upsertSubscription: async () => ({}),
  publicEntitlementMatrix: () => ({}),
  hasFeature: () => false,
};
