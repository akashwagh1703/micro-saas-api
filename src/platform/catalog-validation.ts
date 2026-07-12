import {
  getUseCase,
  getVertical,
  type BusinessVerticalDefinition,
} from './business-verticals.registry';
import { useCaseLabel } from '../modules/workflows/business-workflow';
import { isV4CatalogEnabled } from './v4-feature-flags';

export interface CatalogValidationFailure {
  message: string;
  errors: Record<string, string[]>;
}

export function formatAllowedUseCases(vertical: BusinessVerticalDefinition): string {
  return vertical.allowed_use_cases.map((k) => useCaseLabel(k)).join(', ');
}

/**
 * Validates business + use cases for v4 catalog rules.
 * No-op when V4_CATALOG_ENABLED is false (legacy behavior).
 */
export function validateBusinessSetup(input: {
  businessCategory: string;
  useCases: string[];
  currentCategory?: string | null;
}): CatalogValidationFailure | null {
  if (!isV4CatalogEnabled()) {
    return null;
  }

  const { businessCategory, useCases, currentCategory } = input;
  const vertical = getVertical(businessCategory);

  if (!vertical) {
    return {
      message: 'Invalid business type',
      errors: { business_category: [`Unknown business type: ${businessCategory}`] },
    };
  }

  // Plugin verticals (e.g. CareerAI) use dedicated setup — skip workflow use-case rules.
  if (vertical.kind === 'plugin' || vertical.skip_workflows) {
    return null;
  }

  const continuingSameDeprecated =
    !!vertical.deprecated &&
    !!currentCategory &&
    currentCategory === businessCategory;

  if (vertical.visible_in_signup === false && !continuingSameDeprecated) {
    return {
      message: 'This business type is no longer available for new setup',
      errors: {
        business_category: [
          `${vertical.label} is a legacy business type. Choose one of the supported business types.`,
        ],
      },
    };
  }

  if (useCases.length < 1) {
    return {
      message: 'Select at least one use case',
      errors: { use_cases: ['Select at least one use case.'] },
    };
  }

  if (useCases.length > vertical.max_use_cases) {
    return {
      message: `Invalid use cases for ${vertical.label}`,
      errors: {
        use_cases: [
          `${vertical.label} allows at most ${vertical.max_use_cases} use case(s).`,
        ],
      },
    };
  }

  const allowedSet = new Set(vertical.allowed_use_cases);
  const invalidAllowed = useCases.filter((uc) => !allowedSet.has(uc));
  if (invalidAllowed.length > 0) {
    return {
      message: `Invalid use cases for ${vertical.label}`,
      errors: {
        use_cases: [
          `${vertical.label} allows only: ${formatAllowedUseCases(vertical)} (max ${vertical.max_use_cases} use case(s)).`,
        ],
      },
    };
  }

  const hiddenForSignup = useCases.filter((uc) => {
    const def = getUseCase(uc);
    return def && def.visible_in_signup === false;
  });
  if (hiddenForSignup.length > 0 && !continuingSameDeprecated) {
    return {
      message: 'One or more use cases are no longer available',
      errors: {
        use_cases: hiddenForSignup.map(
          (uc) => `${useCaseLabel(uc)} is no longer available for new setup.`,
        ),
      },
    };
  }

  return null;
}
