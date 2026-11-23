export const scenarios = Object.freeze({
  accessible: { label: "Step-free crew", crew: 8, stepFree: true, tide: "low", detail: "8 volunteers · step-free · low tide" },
  high_tide: { label: "High-tide switch", crew: 12, stepFree: false, tide: "high", detail: "12 volunteers · high tide" },
  no_match: { label: "No safe match", crew: 24, stepFree: true, tide: "high", detail: "24 volunteers · step-free · high tide" }
});

const sites = [
  { id: "T01", name: "Slipway Pocket", stepFree: true, capacity: 10, highTide: false, meeting: "Broad ramp at the blue gate" },
  { id: "T02", name: "Dune Boardwalk", stepFree: true, capacity: 18, highTide: true, meeting: "Trail map at the boardwalk entrance" },
  { id: "T03", name: "Rockpool Steps", stepFree: false, capacity: 16, highTide: false, meeting: "Upper landing beside the rail" }
];

export const siteActions = Object.freeze({
  read_cleanup_sites: {
    description: "Read Tide Desk's fictional site catalog: access, capacity, tides and meeting points.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
    effect: "read",
    handler: () => sites.map(site => ({ ...site }))
  }
});
