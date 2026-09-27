// The app's own credit, closing the Support view: who built the map and
// schedule, and how to reach him. It's about the app, not the festival, so it
// lives here rather than in the organizers' sheet.

export const CREDIT_EMAIL = 'amanfredi_dev@fastmail.com';

// The cairn mark from Anthony's brand files (am-mark-bare.svg). Inline, so it
// costs no request and no cache entry; decorative, because the sentence beside
// it already names him.
const MARK = `<svg class="app-credit__mark" viewBox="16.8 15.1 86.1 92.1" aria-hidden="true" focusable="false">
  <path fill="#44525c" d="M100.7 94.8C99.5 97.6 95.8 100.7 90.0 102.6C84.2 104.4 74.3 105.6 66.0 105.9C57.7 106.2 47.5 105.6 40.4 104.4C33.3 103.3 26.9 101.1 23.4 98.9C19.9 96.7 17.8 93.9 19.3 91.3C20.8 88.7 26.2 85.5 32.2 83.2C38.3 81.0 47.5 78.5 55.6 77.8C63.7 77.2 73.7 78.0 80.7 79.3C87.7 80.6 94.1 83.1 97.4 85.7C100.8 88.3 101.9 92.0 100.7 94.8Z"/>
  <path fill="#5d6d77" d="M83.8 67.2C82.5 69.3 80.0 71.4 75.8 72.8C71.5 74.2 64.3 75.3 58.3 75.5C52.4 75.7 45.2 75.0 39.9 73.9C34.6 72.8 29.0 70.9 26.5 68.7C24.1 66.5 23.7 63.3 25.2 60.8C26.6 58.4 30.8 55.6 35.3 54.1C39.8 52.6 46.3 52.0 52.1 52.0C58.0 52.0 65.3 52.6 70.5 54.0C75.8 55.4 81.2 58.0 83.4 60.2C85.6 62.4 85.0 65.1 83.8 67.2Z"/>
  <path fill="#77878f" d="M82.8 42.4C82.1 44.4 80.1 46.5 77.2 47.8C74.4 49.0 69.5 49.6 65.7 49.7C61.8 49.8 57.3 49.1 54.0 48.3C50.7 47.4 47.7 46.0 46.1 44.6C44.4 43.1 43.6 41.2 44.3 39.4C44.9 37.7 47.0 35.3 49.8 33.9C52.5 32.5 57.0 31.5 60.9 31.1C64.7 30.6 69.3 30.4 72.8 31.2C76.2 32.0 79.9 33.9 81.6 35.7C83.3 37.6 83.5 40.4 82.8 42.4Z"/>
  <path fill="#6b8f5a" d="M68.8 24.3C68.4 25.4 67.3 26.7 65.8 27.4C64.3 28.1 61.7 28.6 59.6 28.8C57.5 28.9 55.1 28.7 53.3 28.1C51.5 27.6 49.7 26.5 48.9 25.3C48.2 24.1 48.3 22.5 48.7 21.2C49.1 19.8 50.0 18.0 51.5 17.1C53.0 16.3 55.6 16.1 57.6 16.1C59.7 16.2 62.0 16.7 63.7 17.4C65.4 18.2 67.2 19.4 68.0 20.6C68.9 21.7 69.1 23.1 68.8 24.3Z"/>
</svg>`;

export function appCreditHtml() {
  return `
    <footer class="app-credit" data-testid="app-credit">
      ${MARK}
      <p class="app-credit__text">This map and schedule app was built and donated by Anthony Manfredi.
        <a href="mailto:${CREDIT_EMAIL}">${CREDIT_EMAIL}</a></p>
    </footer>`;
}
