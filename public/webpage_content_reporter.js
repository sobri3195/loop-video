/*
  Netlify occasionally injects a script tag for /webpage_content_reporter.js.
  In some deployments this ends up being served/parsed in a way that triggers
  "Unexpected token 'export'" in the browser.

  Providing this no-op file ensures the injected request resolves to a valid
  classic script and does not break the app.
*/

(function () {
  // no-op
})();
