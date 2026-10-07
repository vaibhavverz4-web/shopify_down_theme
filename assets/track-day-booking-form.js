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

  // Local-time YYYY-MM-DD, `days` from today.
  const isoDateFromToday = (days = 0) => {
    const date = new Date();
    date.setDate(date.getDate() + days);
    date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
    return date.toISOString().slice(0, 10);
  };

  const getFieldError = (input) => {
    const { validity, dataset } = input;
    // A partially typed / impossible date (e.g. a 6-digit year) reports
    // badInput with an empty value, so check it before "required".
    if (validity.badInput) return dataset.invalidMessage;
    if (!input.value.trim()) return dataset.requiredMessage;
    if (validity.rangeUnderflow && dataset.underflowMessage) return dataset.underflowMessage;
    if (validity.rangeOverflow && dataset.overflowMessage) return dataset.overflowMessage;
    if (!input.checkValidity()) return dataset.invalidMessage || dataset.requiredMessage;
    return '';
  };

  // Show an error while typing only when waiting for blur would be pointless:
  // a date (a picker choice or typed date is a complete action).
  const shouldValidateInstantly = (input) => input.type === 'date';

  // Phone fields accept digits with an optional leading "+": up to
  // data-phone-local-digits digits without it (a local number) and up to
  // data-phone-max-digits with it (an international number). The final
  // format is checked by the input's `pattern`.
  const isPhoneField = (input) => input.matches?.(`input[data-phone-max-digits]${FIELD_SELECTOR}`);

  const getPhoneMaxDigits = (input, hasLeadingPlus) =>
    Number(hasLeadingPlus ? input.dataset.phoneMaxDigits : input.dataset.phoneLocalDigits) ||
    Number(input.dataset.phoneMaxDigits) ||
    15;

  // True when the value only has digits, a "+" (if any) in first position,
  // and no more than the maximum number of digits for that format.
  const isAllowedPhone = (input, value) => {
    const hasLeadingPlus = value.startsWith('+');
    const digits = hasLeadingPlus ? value.slice(1) : value;
    return new RegExp(`^\\d{0,${getPhoneMaxDigits(input, hasLeadingPlus)}}$`).test(digits);
  };

  // Strips everything but digits and keeps a "+" only if the text starts with
  // one (e.g. pasted "+91 97129-92967" becomes "+919712992967"). A number too
  // long to be local is treated as international: "0091…" or "91…" (12
  // digits) becomes "+91…" instead of being cut short.
  const normalizePhone = (input, raw) => {
    let hasLeadingPlus = raw.trim().startsWith('+');
    let digits = raw.replace(/\D/g, '');
    if (!hasLeadingPlus && digits.length > getPhoneMaxDigits(input, false)) {
      hasLeadingPlus = true;
      if (digits.startsWith('00')) digits = digits.slice(2);
    }
    return (hasLeadingPlus ? '+' : '') + digits.slice(0, getPhoneMaxDigits(input, hasLeadingPlus));
  };

  // Fallback for edits `beforeinput` doesn't block (autofill, drag and drop,
  // some mobile keyboards): strips any invalid characters straight away.
  const sanitizePhone = (input) => {
    if (isAllowedPhone(input, input.value)) return;
    input.value = normalizePhone(input, input.value);
  };

  // A date input's own value is always yyyy-mm-dd; mirror it into the hidden
  // dd/mm/yyyy field that actually gets submitted as the line item property.
  const syncDateHidden = (input) => {
    const hidden = input.parentElement?.querySelector('[data-track-day-date-hidden]');
    if (!hidden) return;
    const [year, month, day] = input.value.split('-');
    hidden.value = input.validity.valid && day ? `${day}/${month}/${year}` : '';
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
      const trimmed = input.value.trim();
      if (trimmed !== input.value) input.value = trimmed;
      const message = getFieldError(input);
      setFieldError(input, message);
      if (input.type === 'date') syncDateHidden(input);
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

    // The Liquid min/max use the store's timezone and cached page time;
    // refresh them to the shopper's local today.
    bookingForm.querySelectorAll('input[type="date"]').forEach((dateInput) => {
      dateInput.min = isoDateFromToday();
      const maxDaysAhead = Number(dateInput.dataset.maxDaysAhead);
      if (maxDaysAhead) dateInput.max = isoDateFromToday(maxDaysAhead);
    });

    // Clean up a value the browser restored (back/forward cache) or autofilled.
    bookingForm.querySelectorAll(`input[data-phone-max-digits]${FIELD_SELECTOR}`).forEach(sanitizePhone);
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

    if (isPhoneField(input)) sanitizePhone(input);
    if (input.type === 'date') syncDateHidden(input);

    // Clear an error as soon as the field is fixed; otherwise only flag it
    // mid-typing when it is already definitely wrong.
    if (input.getAttribute('aria-invalid') === 'true' || shouldValidateInstantly(input)) {
      setFieldError(input, getFieldError(input));
    }
    if (isValid(bookingForm)) setSummaryError(bookingForm, false);
    updateLock(bookingForm);
  });

  document.addEventListener('focusout', (event) => {
    const input = event.target;
    if (!input.matches?.(FIELD_SELECTOR) || (!input.value && !input.validity.badInput)) return;
    setFieldError(input, getFieldError(input));
  });

  // Block a typed character that can't be part of a phone number: a letter,
  // space or symbol, a "+" anywhere but first, or a digit past the maximum.
  document.addEventListener('beforeinput', (event) => {
    const input = event.target;
    if (!isPhoneField(input) || event.inputType !== 'insertText' || input.selectionStart === null) return;
    const { value, selectionStart, selectionEnd } = input;
    const next = value.slice(0, selectionStart) + (event.data || '') + value.slice(selectionEnd);
    if (!isAllowedPhone(input, next)) event.preventDefault();
  });

  // Pasting is handled here so "+971 (50) 123-4567" is cleaned up instead of
  // being cut short by `maxlength` before its spaces and symbols are removed.
  document.addEventListener('paste', (event) => {
    const input = event.target;
    if (!isPhoneField(input)) return;
    event.preventDefault();

    const pasted = event.clipboardData?.getData('text') || '';
    const { value, selectionStart, selectionEnd } = input;
    const before = value.slice(0, selectionStart);
    // Pasted text only keeps its "+" when it lands at the very start.
    input.value = normalizePhone(input, before + (before ? pasted.replace(/\+/g, '') : pasted) + value.slice(selectionEnd));
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });

  // Date pickers can commit a value via `change` without an `input` event.
  document.addEventListener('change', (event) => {
    const input = event.target;
    if (!input.matches?.('input[type="date"]' + FIELD_SELECTOR)) return;
    const bookingForm = input.closest(FORM_SELECTOR);
    setFieldError(input, getFieldError(input));
    syncDateHidden(input);
    if (isValid(bookingForm)) setSummaryError(bookingForm, false);
    updateLock(bookingForm);
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
