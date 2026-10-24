/** Durable settings namespace for product-wide GUI onboarding facts. */
export const WELCOME_NOTICE_SETTINGS_NAMESPACE = 'ui-onboarding'

/** Field storing the last welcome notice version the user acknowledged. */
export const WELCOME_NOTICE_ACK_FIELD = 'welcomeNoticeVersion'

/**
 * Bump only when the notice changes materially and every user should see it
 * again. The acknowledgement is compared for exact equality.
 */
export const WELCOME_NOTICE_VERSION = '2026-08-15.1'

/** The complete editable internal-testing notice in both supported GUI locales. */
export const WELCOME_NOTICE_COPY = {
  da: {
    title: 'Meddelelse om intern afprøvning',
    body: 'Biyocon Harness 0.1 er fortsat under afprøvning for Harness-udviklere. Mange områder kræver yderligere forbedringer, og vi modtager gerne feedback fra udviklerfællesskabet. Biyocon Harness’ kerneplugins og grundlæggende API’er vil fortsat udvikle sig hurtigt i de kommende måneder.\n\nVi ser frem til at udforske grænserne for intelligens sammen med udviklere over hele verden på grundlag af open source og åben, genanvendelig infrastruktur, der kan sammensættes. Harness-udviklere fra hele verden er velkomne i DSH’s plugin-økosystem.',
    continueLabel: 'Fortsæt',
  },
  en: {
    title: 'Internal Testing Notice',
    body: "Biyocon Harness 0.1 remains in testing for Harness developers. Many areas need further improvement, and we welcome feedback from the developer community. Biyocon Harness's core plugins and foundational APIs will continue to evolve rapidly over the coming months.\n\nWe look forward to exploring the limits of intelligence with developers around the world, building on open-source, open, reusable, and composable infrastructure. We welcome Harness developers everywhere to join the DSH plugin ecosystem.",
    continueLabel: 'Continue',
  },
} as const
