/* ==========================================================================
   custom.js
   Create this file at assets/custom.js and register it in layout/theme.liquid:
       <script src="{{ 'custom.js' | asset_url }}" defer="defer"></script>
   Add new section modules to the registry at the bottom.
   ========================================================================== */

(function () {
  'use strict';

  /* ------------------------------------------------------------------
     Trianon Hero
     Staggers the content in once the section scrolls into view.
     ------------------------------------------------------------------ */

  var TrianonHero = {
    selector: '[data-thero][data-thero-animate]',

    init: function (root) {
      var scope = root || document;
      var heroes = scope.querySelectorAll(this.selector);

      for (var i = 0; i < heroes.length; i++) {
        this.setup(heroes[i]);
      }
    },

    setup: function (hero) {
      if (hero.dataset.theroBound === 'true') return;
      hero.dataset.theroBound = 'true';

      // Index each item so CSS can stagger the transition-delay.
      var items = hero.querySelectorAll('[data-thero-item]');
      for (var i = 0; i < items.length; i++) {
        items[i].style.setProperty('--thero-item-index', i);
      }

      var reveal = function () {
        hero.classList.add('thero--ready');
      };

      // No IntersectionObserver, or reduced motion: show immediately.
      var reduced =
        window.matchMedia &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches;

      if (reduced || !('IntersectionObserver' in window)) {
        reveal();
        return;
      }

      var observer = new IntersectionObserver(
        function (entries) {
          for (var i = 0; i < entries.length; i++) {
            if (entries[i].isIntersecting) {
              reveal();
              observer.disconnect();
            }
          }
        },
        { rootMargin: '0px 0px -10% 0px', threshold: 0.1 }
      );

      observer.observe(hero);
    },

    // Theme editor re-renders a section: re-run setup on the new markup.
    onSectionLoad: function (event) {
      this.init(event.target);
    },
  };

  /* ------------------------------------------------------------------
     Registry — add future section modules here
     ------------------------------------------------------------------ */

  var modules = [TrianonHero];

  function initAll(root) {
    for (var i = 0; i < modules.length; i++) {
      if (typeof modules[i].init === 'function') {
        modules[i].init(root);
      }
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      initAll(document);
    });
  } else {
    initAll(document);
  }

  // Shopify theme editor events
  document.addEventListener('shopify:section:load', function (event) {
    for (var i = 0; i < modules.length; i++) {
      if (typeof modules[i].onSectionLoad === 'function') {
        modules[i].onSectionLoad(event);
      }
    }
  });
})();
