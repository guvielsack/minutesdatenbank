async function api(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (!(options.body instanceof FormData) && !headers["Content-Type"]) {
    headers["Content-Type"] = "application/json";
  }
  const response = await fetch(path, {
    headers,
    credentials: "include",
    ...options,
  });
  if (!response.ok) {
    const detail = await response.text();
    let message = detail || response.statusText;
    try {
      const parsed = JSON.parse(detail);
      if (parsed.detail) message = String(parsed.detail);
    } catch {
      // keep raw
    }
    throw new Error(message);
  }
  if (response.status === 204) return null;
  return response.json();
}

function roleLabel(role) {
  if (role === "admin") return "Admin";
  if (role === "protokollant") return "Protokollant";
  return role;
}

async function ensureAdmin() {
  const auth = await api("/api/auth/me");
  if (!auth.can_admin) {
    window.location.href = "/login";
    throw new Error("Keine Admin-Berechtigung");
  }
  return auth;
}

async function loadUsers() {
  const users = await api("/api/admin/users");
  const root = document.getElementById("users-table");
  if (!users.length) {
    root.innerHTML = "<p>Keine Benutzer.</p>";
    return;
  }

  const rows = users
    .map(
      (user) => `
      <tr data-user-id="${user.id}">
        <td>${user.username}</td>
        <td>
          <select class="user-role">
            <option value="protokollant" ${user.role === "protokollant" ? "selected" : ""}>Protokollant</option>
            <option value="admin" ${user.role === "admin" ? "selected" : ""}>Admin</option>
          </select>
        </td>
        <td>
          <label><input type="checkbox" class="user-active" ${user.is_active ? "checked" : ""} /> aktiv</label>
        </td>
        <td>
          <input type="password" class="user-password" placeholder="Neues Passwort" minlength="8" />
        </td>
        <td><button type="button" class="save-user">Speichern</button></td>
      </tr>`
    )
    .join("");

  root.innerHTML = `
    <table>
      <thead>
        <tr><th>Benutzer</th><th>Rolle</th><th>Status</th><th>Passwort</th><th></th></tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;

  root.querySelectorAll(".save-user").forEach((button) => {
    button.addEventListener("click", async () => {
      const row = button.closest("tr");
      const userId = row.dataset.userId;
      const payload = {
        role: row.querySelector(".user-role").value,
        is_active: row.querySelector(".user-active").checked,
      };
      const password = row.querySelector(".user-password").value.trim();
      if (password) payload.password = password;
      try {
        await api(`/api/admin/users/${userId}`, {
          method: "PATCH",
          body: JSON.stringify(payload),
        });
        row.querySelector(".user-password").value = "";
        alert("Benutzer gespeichert.");
      } catch (error) {
        alert(error.message);
      }
    });
  });
}

document.getElementById("user-create-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    await api("/api/admin/users", {
      method: "POST",
      body: JSON.stringify({
        username: document.getElementById("new-username").value.trim(),
        password: document.getElementById("new-password").value,
        role: document.getElementById("new-role").value,
      }),
    });
    document.getElementById("new-username").value = "";
    document.getElementById("new-password").value = "";
    document.getElementById("new-role").value = "protokollant";
    await loadUsers();
  } catch (error) {
    alert(error.message);
  }
});

document.getElementById("logout-btn").addEventListener("click", async () => {
  await api("/api/auth/logout", { method: "POST" });
  window.location.href = "/login";
});

ensureAdmin()
  .then(() => loadUsers())
  .catch((error) => {
    console.error(error);
  });
