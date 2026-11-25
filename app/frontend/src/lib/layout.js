// REQ-520 (owner decision "Caps everywhere"): one centred content column per page kind, shared by the header and the page.
// Widths are content box plus the 24 px gutters (px-6); below the cap each column is simply viewport - 48.
export const FRAME = 'mx-auto w-full max-w-[1488px] px-6'; // working pages and the header: 1440 px
export const WIZARD = 'mx-auto w-full max-w-[1088px] px-6'; // Launch, Generate data, Setup forms: 1040 px
export const LANDING = 'mx-auto w-full max-w-[1328px] px-6'; // Home: 1280 px
export const RESULTS_FRAME = `${FRAME} py-4 sm:py-5`;
