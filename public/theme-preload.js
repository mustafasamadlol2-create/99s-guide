(function () {
  try {
    var saved = localStorage.getItem("app_theme");
    var isDark = saved === "dark" || (saved !== "light" && window.matchMedia("(prefers-color-scheme: dark)").matches);
    if (isDark) {
      document.documentElement.classList.add("dark");
      document.documentElement.style.backgroundColor = "#06152f";
      document.body.style.backgroundColor = "#06152f";
    } else {
      document.documentElement.style.backgroundColor = "#f5f1ec";
      document.body.style.backgroundColor = "#f5f1ec";
    }
  } catch (error) {
    // Theme initialization is best-effort and must not block app startup.
  }
})();
