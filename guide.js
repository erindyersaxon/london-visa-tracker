// Guide page scripts — loaded deferred

// ── Sidebar active section highlighting ──────────────────────────────────────
(function() {
  const sections = document.querySelectorAll('.section');
  const sidebarLinks = document.querySelectorAll('.sidebar-nav a');

  if (!sections.length || !sidebarLinks.length) return;

  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        sidebarLinks.forEach(a => a.classList.remove('active'));
        const active = document.querySelector(`.sidebar-nav a[href="#${entry.target.id}"]`);
        if (active) active.classList.add('active');
      }
    });
  }, { rootMargin: '-20% 0px -70% 0px' });

  sections.forEach(s => observer.observe(s));
})();

// ── Back to top button ────────────────────────────────────────────────────────
window.addEventListener('scroll', () => {
  const btn = document.getElementById('back-top');
  if (btn) btn.style.opacity = window.scrollY > 400 ? '1' : '0';
}, { passive: true });
