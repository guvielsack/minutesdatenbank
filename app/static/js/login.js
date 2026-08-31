document.getElementById("login-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const errorBox = document.getElementById("login-error");
  errorBox.classList.add("hidden");

  const username = document.getElementById("login-username").value.trim();
  const password = document.getElementById("login-password").value;

  try {
    const response = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ username, password }),
    });
    if (!response.ok) {
      const detail = await response.text();
      let message = "Anmeldung fehlgeschlagen";
      try {
        const parsed = JSON.parse(detail);
        if (parsed.detail) message = String(parsed.detail);
      } catch {
        // keep default
      }
      throw new Error(message);
    }
    window.location.href = "/";
  } catch (error) {
    errorBox.textContent = error.message;
    errorBox.classList.remove("hidden");
  }
});
