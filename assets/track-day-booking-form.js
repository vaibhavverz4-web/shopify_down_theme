// Enforces the required Track Day booking fields rendered by
// snippets/track-day-booking-form.liquid.
//
// The product form is `novalidate` and product-form.js submits it over AJAX,
// so native `required` is never checked. This script:
// - intercepts submit in the capture phase (before product-form.js) and cancels
//   it while any booking field is empty or invalid;
// - makes the "Buy it now" / accelerated checkout button `inert` until the form
//   is valid (it bypasses the form submit entirely), and shows the errors when
//   the locked button is clicked.
if (!window.trackDayBookingFormLoaded) {
  window.trackDayBookingFormLoaded = true;

  const FORM_SELECTOR = '[data-track-day-form]';
  const FIELD_SELECTOR = '[data-track-day-field]';

  const getFields = (bookingForm) => Array.from(bookingForm.querySelectorAll(FIELD_SELECTOR));

  const getPaymentButton = (bookingForm) => bookingForm.closest('form')?.querySelector('.shopify-payment-button');

  const todayISO = () => {
    const now = new Date();
    now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
    return now.toISOString().slice(0, 10);
  };

  const getFieldError = (input) => {
    if (!input.value.trim()) return input.dataset.requiredMessage;
    if (!input.checkValidity()) return input.dataset.invalidMessage || input.dataset.requiredMessage;
    return '';
  };

  const setFieldError = (input, message) => {
    const error = document.getElementById(input.getAttribute('aria-describedby'));
    if (message) {
      input.setAttribute('aria-invalid', 'true');
    } else {
      input.removeAttribute('aria-invalid');
    }
    if (!error) return;
    error.querySelector('.track-day-booking-form__error-text').textContent = message || '';
    error.hidden = !message;
  };

  const setSummaryError = (bookingForm, show) => {
    const productForm = bookingForm.closest('product-form');
    if (typeof productForm?.handleErrorMessage !== 'function') return;

    // Only clear the summary if we set it, so cart errors are left alone.
    if (show) {
      productForm.handleErrorMessage(bookingForm.dataset.summaryMessage);
      bookingForm.dataset.summaryShown = 'true';
    } else if (bookingForm.dataset.summaryShown === 'true') {
      productForm.handleErrorMessage();
      delete bookingForm.dataset.summaryShown;
    }
  };

  const isValid = (bookingForm) => getFields(bookingForm).every((input) => !getFieldError(input));

  // Shows errors on every field and returns the first invalid one (or null).
  const validateAll = (bookingForm) => {
    let firstInvalid = null;
    getFields(bookingForm).forEach((input) => {
      input.value = input.value.trim();
      const message = getFieldError(input);
      setFieldError(input, message);
      if (message && !firstInvalid) firstInvalid = input;
    });
    setSummaryError(bookingForm, Boolean(firstInvalid));
    return firstInvalid;
  };

  const updateLock = (bookingForm) => {
    const paymentButton = getPaymentButton(bookingForm);
    if (paymentButton) paymentButton.inert = !isValid(bookingForm);
  };

  const blockAndReport = (bookingForm) => {
    const firstInvalid = validateAll(bookingForm);
    if (!firstInvalid) return false;
    firstInvalid.focus({ preventScroll: true });
    firstInvalid.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return true;
  };

  const init = (bookingForm) => {
    if (bookingForm.dataset.trackDayReady) return;
    bookingForm.dataset.trackDayReady = 'true';

    const dateInput = bookingForm.querySelector('input[type="date"]');
    if (dateInput) dateInput.min = todayISO();
  };

  const refreshAll = () => {
    document.querySelectorAll(FORM_SELECTOR).forEach((bookingForm) => {
      init(bookingForm);
      updateLock(bookingForm);
    });
  };

  // Runs before product-form.js's submit listener on the form itself.
  document.addEventListener(
    'submit',
    (event) => {
      const bookingForm = event.target.querySelector?.(FORM_SELECTOR);
      if (!bookingForm || !blockAndReport(bookingForm)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
    },
    true
  );

  // While "Buy it now" is inert, clicks on it land on its parent container.
  document.addEventListener(
    'click',
    (event) => {
      const paymentButton = event.target.querySelector?.(':scope > .shopify-payment-button[inert]');
      if (!paymentButton) return;
      const bookingForm = paymentButton.closest('form')?.querySelector(FORM_SELECTOR);
      if (!bookingForm) return;

      const rect = paymentButton.getBoundingClientRect();
      const insideButton =
        event.clientX >= rect.left &&
        event.clientX <= rect.right &&
        event.clientY >= rect.top &&
        event.clientY <= rect.bottom;
      if (insideButton) blockAndReport(bookingForm);
    },
    true
  );

  document.addEventListener('input', (event) => {
    const input = event.target;
    if (!input.matches?.(FIELD_SELECTOR)) return;
    const bookingForm = input.closest(FORM_SELECTOR);

    // Clear an error as soon as the field is fixed; don't nag while typing.
    if (input.getAttribute('aria-invalid') === 'true') setFieldError(input, getFieldError(input));
    if (isValid(bookingForm)) setSummaryError(bookingForm, false);
    updateLock(bookingForm);
  });

  document.addEventListener('focusout', (event) => {
    const input = event.target;
    if (!input.matches?.(FIELD_SELECTOR) || !input.value) return;
    setFieldError(input, getFieldError(input));
  });

  // Product info / quick add can replace the form markup, and Shopify injects
  // the payment button asynchronously, so re-apply the lock on DOM changes.
  let refreshQueued = false;
  new MutationObserver(() => {
    if (refreshQueued) return;
    refreshQueued = true;
    requestAnimationFrame(() => {
      refreshQueued = false;
      refreshAll();
    });
  }).observe(document.documentElement, { childList: true, subtree: true });

  refreshAll();
}
