export const SERVICE_CAPABILITIES = ["Verification", "Sampling", "Certification"] as const;

export type ServiceCapability = (typeof SERVICE_CAPABILITIES)[number];
export type ServiceAction = "核真" | "采样" | "认证";

export interface CountryServiceProfile {
  countryCode: string;
  displayName: string;
  capabilities: ServiceCapability[];
  isPilot: boolean;
}

export interface TelegramInlineButton {
  text: string;
  callback_data: string;
}

export const VECTOR_MATRIX: Record<string, CountryServiceProfile> = {
  UAE: {
    countryCode: "UAE",
    displayName: "United Arab Emirates",
    capabilities: [...SERVICE_CAPABILITIES],
    isPilot: true
  },
  SGP: {
    countryCode: "SGP",
    displayName: "Singapore",
    capabilities: ["Verification", "Sampling"],
    isPilot: false
  },
  SAU: {
    countryCode: "SAU",
    displayName: "Saudi Arabia",
    capabilities: ["Verification"],
    isPilot: false
  }
};

export const resolveCountryServices = (countryCode: string): ServiceCapability[] => {
  const normalizedCode = countryCode.toUpperCase();
  return VECTOR_MATRIX[normalizedCode]?.capabilities ?? [];
};

export const buildCountryButtons = (): TelegramInlineButton[][] => {
  return Object.values(VECTOR_MATRIX).map((profile) => [
    {
      text: `${profile.countryCode} · ${profile.displayName}`,
      callback_data: `country:${profile.countryCode}`
    }
  ]);
};

export const capabilityToAction = (capability: ServiceCapability): ServiceAction => {
  if (capability === "Verification") {
    return "核真";
  }
  if (capability === "Sampling") {
    return "采样";
  }
  return "认证";
};

export const actionToCapability = (action: string): ServiceCapability | null => {
  if (action === "核真") {
    return "Verification";
  }
  if (action === "采样") {
    return "Sampling";
  }
  if (action === "认证") {
    return "Certification";
  }
  return null;
};

export const buildCountryServiceButtons = (countryCode: string): TelegramInlineButton[][] => {
  const normalizedCode = countryCode.toUpperCase();
  const profile = VECTOR_MATRIX[normalizedCode];
  if (!profile) {
    return [[{ text: `No services available for ${normalizedCode}`, callback_data: `matrix:${normalizedCode}:none` }]];
  }

  return profile.capabilities.map((capability) => [
    {
      text: capabilityToAction(capability),
      callback_data: `task:${normalizedCode}:${capabilityToAction(capability)}`
    }
  ]);
};

export const parseTaskActionCallback = (
  callbackData: string
): { countryCode: string; action: ServiceAction } | null => {
  const segments = callbackData.split(":");
  if (segments.length !== 3 || segments[0] !== "task") {
    return null;
  }
  const countryCode = segments[1].toUpperCase();
  const action = segments[2] as ServiceAction;
  if (!VECTOR_MATRIX[countryCode]) {
    return null;
  }
  if (!actionToCapability(action)) {
    return null;
  }
  return { countryCode, action };
};
