const viewports = Object.freeze({
  desktop: Object.freeze({ width: 1440, height: 900 }),
  laptop: Object.freeze({ width: 1280, height: 720 }),
  tablet: Object.freeze({ width: 820, height: 900 }),
  mobile: Object.freeze({ width: 390, height: 844 }),
  landscape: Object.freeze({ width: 844, height: 390 }),
});

function semantic(selector, options = {}) {
  return Object.freeze({
    ...options,
    ...(Array.isArray(options.includes) ? { includes: Object.freeze([...options.includes]) } : {}),
    ...(Array.isArray(options.excludes) ? { excludes: Object.freeze([...options.excludes]) } : {}),
    ...(options.attributes ? { attributes: Object.freeze({ ...options.attributes }) } : {}),
    selector,
  });
}

function scenario(id, options = {}) {
  const { semantics = [], ...overrides } = options;
  return Object.freeze({
    after: null,
    captureListType: null,
    density: 'comfortable',
    dock: 'right',
    forcedColors: false,
    layout: 'docked',
    mode: 'qa-profile-following-queue',
    opacity: null,
    open: true,
    pairing: 'action',
    panelHeight: null,
    panelWidth: null,
    position: null,
    presentation: 'panel',
    queue: 'loaded',
    section: 'now',
    targetSelector: '.profile button',
    theme: 'light',
    viewport: 'desktop',
    width: 'standard',
    zoom: 1,
    ...overrides,
    id,
    semantics: Object.freeze([...semantics]),
  });
}

const requiredStates = [
  scenario('toolbox-floating-translucent', {
    layout: 'floating',
    opacity: 0.62,
    panelHeight: 700,
    panelWidth: 440,
    position: { x: 470, y: 72 },
    semantics: [
      semantic('[data-ia-role="now-content"] .ia-tool-grid', {
        includes: ['Follower checker', 'Follow / Unfollow', 'DM Unsend', 'live locked'],
      }),
      semantic('[data-ia-role="move-handle"]', {
        attributes: { 'aria-label': 'Move sidecar; use arrow keys for precise movement', type: 'button' },
      }),
      semantic('[data-ia-role="resize-handle"]', {
        attributes: { 'aria-label': 'Resize sidecar; use arrow keys for precise sizing', type: 'button' },
      }),
      semantic('[data-ia-preference="opacity"]', {
        attributes: { max: '100', min: '55', type: 'range' },
      }),
    ],
    targetSelector: null,
  }),
  scenario('profile-not-following-no-match', {
    mode: 'qa-profile-not-following',
    semantics: [
      semantic('[data-ia-role="now-content"]', {
        includes: ['@demo_creator', 'not-following', 'Next: @someone_else', 'Inspection is no-click'],
      }),
    ],
  }),
  scenario('profile-following-queue-match', {
    semantics: [
      semantic('[data-ia-role="now-content"]', {
        includes: ['@demo_creator', 'following', 'Matches unfollow', 'Inspection is no-click'],
      }),
    ],
  }),
  scenario('profile-ambiguous-safe-stop', {
    mode: 'qa-profile-ambiguous',
    semantics: [
      semantic('[data-ia-role="now-content"]', {
        includes: ['@demo_creator', 'Ambiguous — safe stop', 'Refresh no-click inspection'],
      }),
    ],
  }),
  scenario('followers-first-capture', {
    after: 'capture-visible',
    captureListType: 'followers',
    mode: 'qa-followers-first',
    section: 'capture',
    semantics: [
      semantic('[data-ia-role="capture-count"]', { numberEquals: 3 }),
      semantic('[data-ia-role="capture-detail"]', { includes: ['followers · updated'] }),
      semantic('[data-ia-role="capture-state-title"]', { equals: '3 unique followers accounts captured' }),
      semantic('[data-ia-role="capture-state-detail"]', {
        includes: ['3 rendered', '3 added', '0 duplicates ignored'],
      }),
    ],
    targetSelector: '.fixture-dialog',
  }),
  scenario('following-repeated-capture', {
    after: 'capture-visible',
    captureListType: 'following',
    mode: 'qa-following-repeat',
    section: 'capture',
    semantics: [
      semantic('[data-ia-role="capture-count"]', { numberEquals: 4 }),
      semantic('[data-ia-role="capture-detail"]', { includes: ['following · updated'] }),
      semantic('[data-ia-role="capture-state-title"]', { equals: '4 unique following accounts captured' }),
      semantic('[data-ia-role="capture-state-detail"]', {
        includes: ['3 rendered', '2 added', '1 duplicate ignored'],
      }),
    ],
    targetSelector: '.fixture-dialog',
  }),
  scenario('queue-locked', {
    mode: 'qa-queue-locked',
    section: 'queue',
    semantics: [
      semantic('[data-ia-role="live-title"]', { equals: 'Live actions locked' }),
      semantic('[data-ia-role="live-badge"]', { equals: 'locked', tone: 'warning' }),
      semantic('[data-ia-role="live-detail"]', { includes: ['Confirm one live item in the paired PWA'] }),
      semantic('[data-ia-action="arm-account-live"]', { disabled: true }),
    ],
    targetSelector: null,
  }),
  scenario('queue-exact-target-ready', {
    mode: 'qa-account-ready',
    section: 'queue',
    semantics: [
      semantic('[data-ia-role="live-title"]', { equals: 'unfollow @demo_creator' }),
      semantic('[data-ia-role="live-badge"]', { equals: 'ready', tone: 'warning' }),
      semantic('[data-ia-role="live-detail"]', {
        includes: ['exactly match the signed intent', 'Arming alone does not click'],
      }),
      semantic('[data-ia-action="arm-account-live"]', { disabled: false }),
    ],
  }),
  scenario('queue-armed-countdown', {
    mode: 'qa-account-armed',
    presentation: 'strip',
    section: 'queue',
    semantics: [
      semantic('[data-ia-role="live-title"]', { equals: 'unfollow @demo_creator' }),
      semantic('[data-ia-role="live-badge"]', { equals: 'armed', tone: 'danger' }),
      semantic('[data-ia-role="live-countdown"]', { hidden: false, includes: ['s remaining'] }),
      semantic('[data-ia-action="arm-account-live"]', { disabled: true }),
      semantic('[data-ia-role="collision-state"]', {
        equals: 'One-use arm active · page controls remain untouched',
      }),
    ],
  }),
  scenario('queue-arm-expired', {
    after: 'wait-account-expired',
    mode: 'qa-account-expiring',
    section: 'queue',
    semantics: [
      semantic('[data-ia-role="live-title"]', { equals: 'unfollow @demo_creator' }),
      semantic('[data-ia-role="live-badge"]', { equals: 'expired', tone: 'danger' }),
      semantic('[data-ia-role="live-detail"]', {
        includes: ['prior arm expired', 'old expiry is never extended'],
      }),
      semantic('[data-ia-role="live-countdown"]', { hidden: true }),
      semantic('[data-ia-action="arm-account-live"]', { disabled: false }),
    ],
  }),
  scenario('messages-evidence-only', {
    after: 'inspect-messages',
    mode: 'messages',
    section: 'messages',
    semantics: [
      semantic('[data-ia-role="message-count"]', { numberEquals: 3 }),
      semantic('[data-ia-role="message-state-title"]', { equals: 'Conversation ready' }),
      semantic('[data-ia-role="message-state-detail"]', {
        includes: ['read visible evidence', 'Unsend all DMs'],
      }),
      semantic('[data-ia-role="dm-live-badge"]', { equals: 'locked', tone: 'neutral' }),
    ],
    targetSelector: '.fixture-thread [role="row"]',
  }),
  scenario('messages-exact-target-ready', {
    mode: 'qa-messages-ready',
    section: 'messages',
    semantics: [
      semantic('[data-ia-role="dm-live-title"]', { equals: 'Message sent-1' }),
      semantic('[data-ia-role="dm-live-badge"]', { equals: 'ready', tone: 'warning' }),
      semantic('[data-ia-role="dm-live-detail"]', {
        includes: ['Exactly one rendered sent-message identity matches', 'Arming does not open its menu'],
      }),
      semantic('[data-ia-action="arm-dm-live"]', { disabled: false }),
    ],
    targetSelector: '[data-message-id="sent-1"]',
  }),
  scenario('messages-wrong-conversation', {
    mode: 'qa-messages-wrong',
    section: 'messages',
    semantics: [
      semantic('[data-ia-role="dm-live-title"]', { equals: 'Message sent-1' }),
      semantic('[data-ia-role="dm-live-badge"]', { equals: 'open message', tone: 'danger' }),
      semantic('[data-ia-role="dm-live-detail"]', { includes: ['Open the exact conversation'] }),
      semantic('[data-ia-action="arm-dm-live"]', { disabled: true }),
    ],
    targetSelector: '[data-message-id="sent-1"]',
  }),
  scenario('messages-armed-countdown', {
    mode: 'qa-messages-armed',
    presentation: 'strip',
    section: 'messages',
    semantics: [
      semantic('[data-ia-role="dm-live-title"]', { equals: 'Message sent-1' }),
      semantic('[data-ia-role="dm-live-badge"]', { equals: 'armed', tone: 'danger' }),
      semantic('[data-ia-role="dm-live-countdown"]', { hidden: false, includes: ['s remaining'] }),
      semantic('[data-ia-action="arm-dm-live"]', { disabled: true }),
      semantic('[data-ia-role="collision-target"]', { equals: 'message sent-1' }),
      semantic('[data-ia-role="collision-state"]', {
        equals: 'One-use arm active · page controls remain untouched',
      }),
    ],
    targetSelector: '[data-message-id="sent-1"]',
  }),
  scenario('workspace-unpaired', {
    mode: 'qa-workspace',
    pairing: 'none',
    section: 'workspace',
    semantics: [
      semantic('[data-ia-role="bridge-title"]', { equals: 'Workspace not paired' }),
      semantic('[data-ia-role="bridge-detail"]', { includes: ['pair the exact PWA tab'] }),
      semantic('[data-ia-role="bridge-facts"] div:nth-child(2) dd', { equals: 'None' }),
      semantic('[data-ia-role="workspace-link"]', { attributes: { 'aria-disabled': 'true' } }),
    ],
    targetSelector: null,
  }),
  scenario('workspace-read-only', {
    mode: 'qa-workspace',
    pairing: 'read',
    section: 'workspace',
    semantics: [
      semantic('[data-ia-role="bridge-title"]', { equals: 'Workspace paired' }),
      semantic('[data-ia-role="bridge-facts"] div:nth-child(2) dd', { equals: 'read' }),
      semantic('[data-ia-role="workspace-link"]', { attributes: { 'aria-disabled': null } }),
    ],
    targetSelector: null,
  }),
  scenario('workspace-action-permission', {
    mode: 'qa-workspace',
    pairing: 'action',
    section: 'workspace',
    semantics: [
      semantic('[data-ia-role="bridge-title"]', { equals: 'Workspace paired' }),
      semantic('[data-ia-role="bridge-facts"] div:nth-child(2) dd', { equals: 'read + action' }),
      semantic('[data-ia-role="workspace-link"]', { attributes: { 'aria-disabled': null } }),
    ],
    targetSelector: null,
  }),
  scenario('native-dialog-coexistence', {
    mode: 'qa-native-dialog',
    presentation: 'strip',
    section: 'queue',
    semantics: [
      semantic('[data-ia-role="live-badge"]', { equals: 'armed', tone: 'danger' }),
      semantic('[data-ia-role="collision-target"]', { equals: '@demo_creator' }),
      semantic('[data-ia-role="collision-state"]', {
        equals: 'Instagram action surface visible · overlay controls suspended',
      }),
    ],
    targetSelector: '.fixture-native-surface',
  }),
  scenario('session-expired', {
    mode: 'qa-session-expired',
    semantics: [
      semantic('[data-ia-role="now-content"]', {
        includes: ['Login required', 'Sign in manually before inspecting again'],
      }),
    ],
    targetSelector: null,
  }),
  scenario('session-challenge', {
    mode: 'qa-session-challenge',
    semantics: [
      semantic('[data-ia-role="now-content"]', {
        includes: ['Challenge detected', 'Resolve Instagram’s challenge manually'],
      }),
    ],
    targetSelector: null,
  }),
  scenario('session-rate-limited', {
    mode: 'qa-session-rate-limit',
    semantics: [
      semantic('[data-ia-role="now-content"]', {
        includes: ['Rate limit detected', 'Wait before doing more work in this session'],
      }),
    ],
    targetSelector: null,
  }),
];

const matrixStates = [
  scenario('profile-dark-desktop', { theme: 'dark' }),
  scenario('queue-dark-desktop', { section: 'queue', theme: 'dark' }),
  scenario('profile-short-laptop', { viewport: 'laptop' }),
  scenario('queue-short-laptop-dark', { section: 'queue', theme: 'dark', viewport: 'laptop' }),
  scenario('profile-narrow-tablet', { viewport: 'tablet' }),
  scenario('messages-narrow-tablet-dark', {
    after: 'inspect-messages',
    mode: 'messages',
    section: 'messages',
    targetSelector: '.fixture-thread [role="row"]',
    theme: 'dark',
    viewport: 'tablet',
  }),
  scenario('profile-mobile-portrait', { viewport: 'mobile' }),
  scenario('queue-mobile-portrait-dark', { section: 'queue', theme: 'dark', viewport: 'mobile' }),
  scenario('profile-mobile-landscape', { viewport: 'landscape' }),
  scenario('queue-mobile-landscape-dark', { section: 'queue', theme: 'dark', viewport: 'landscape' }),
  scenario('profile-zoom-200-light', { zoom: 2 }),
  scenario('profile-zoom-200-dark', { theme: 'dark', zoom: 2 }),
  scenario('queue-zoom-200-light', { section: 'queue', zoom: 2 }),
  scenario('queue-zoom-200-dark', {
    section: 'queue',
    semantics: [
      semantic('[data-ia-role="queue-open"]', {
        equals: 'Open profile',
        minContrast: 4.5,
        visible: true,
      }),
    ],
    theme: 'dark',
    zoom: 2,
  }),
  scenario('profile-forced-colors', { forcedColors: true }),
  scenario('queue-forced-colors', { forcedColors: true, section: 'queue' }),
  scenario('collapsed-desktop', {
    open: false,
    presentation: 'launcher',
    targetSelector: '.profile button',
  }),
  scenario('collapsed-mobile', {
    open: false,
    presentation: 'launcher',
    targetSelector: '.profile button',
    viewport: 'mobile',
  }),
  scenario('queue-run-review', {
    after: 'bot-review',
    section: 'queue',
    semantics: [
      semantic('[data-ia-role="bot-badge"]', { equals: '1 reviewed', tone: 'warning' }),
      semantic('[data-ia-role="bot-review-title"]', { equals: '1 target ready to confirm' }),
      semantic('[data-ia-role="bot-review-detail"]', {
        includes: ['0 duplicates removed', '0 left outside this bounded run', 'rechecked before action'],
      }),
      semantic('[data-ia-role="bot-detail"]', { includes: ['Reviewed: @demo_creator', 'rechecked before action'] }),
      semantic('[data-ia-role="bot-review-list"]', { includes: ['@demo_creator'] }),
      semantic('[data-ia-action="bot-review"]', { hidden: true }),
      semantic('[data-ia-action="bot-start"]', { hidden: false }),
    ],
    targetSelector: null,
  }),
];

export const overlayQaScenarios = Object.freeze([...requiredStates, ...matrixStates]);
export { viewports };
