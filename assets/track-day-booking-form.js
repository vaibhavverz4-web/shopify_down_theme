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

  // Phone fields accept a local number (e.g. "81234567") or the same number
  // with its country code ("+6581234567"). data-phone-country-code and
  // data-phone-digits set the country code and local number length.
  const isPhoneField = (input) => input.matches?.(`input[data-phone-country-code]${FIELD_SELECTOR}`);

  const getPhoneFormat = (input) => ({
    countryCode: input.dataset.phoneCountryCode,
    digits: Number(input.dataset.phoneDigits),
  });

  // True while the value can still become a valid number by typing more:
  // "", "8123", "+", "+6", "+65", "+658123", … but never a 9th local digit,
  // a non-digit, a "+" that isn't first, or another country's code.
  const isPhoneInProgress = (input, value) => {
    const { countryCode, digits } = getPhoneFormat(input);
    if (!value.startsWith('+')) return new RegExp(`^\\d{0,${digits}}$`).test(value);
    const typed = value.slice(1);
    if (!/^\d*$/.test(typed)) return false;
    if (typed.length <= countryCode.length) return countryCode.startsWith(typed);
    return typed.startsWith(countryCode) && typed.length <= countryCode.length + digits;
  };

  // Cleans pasted or autofilled text into "<local digits>" or
  // "+<country code><local digits>": strips spaces, dashes and brackets,
  // accepts "0065…" / "65…" as the country code, and caps the local number.
  // Returns null for another country's number rather than truncating it into
  // a wrong local one.
  const normalizePhone = (input, raw) => {
    const { countryCode, digits: localLength } = getPhoneFormat(input);
    const trimmed = raw.trim();
    const allDigits = trimmed.replace(/\D/g, '');

    if (trimmed.startsWith('+')) {
      if (!allDigits.startsWith(countryCode)) return null;
      return `+${countryCode}${allDigits.slice(countryCode.length, countryCode.length + localLength)}`;
    }
    if (allDigits.length > localLength) {
      const code = [`00${countryCode}`, countryCode].find((prefix) => allDigits.startsWith(prefix));
      if (code) return `+${countryCode}${allDigits.slice(code.length, code.length + localLength)}`;
    }
    return allDigits.slice(0, localLength);
  };

  // Last accepted value of each phone field, restored when an edit breaks it.
  const lastPhoneValues = new WeakMap();

  // Fallback for edits `beforeinput` doesn't catch. A delete that breaks the
  // number (e.g. removing the "6" of "+65…") is undone; autofill or a dropped
  // value is cleaned up with normalizePhone. Returns false if another
  // country's number was rejected (the field is then cleared).
  const sanitizePhone = (input, inputType = '') => {
    let accepted = true;
    if (!isPhoneInProgress(input, input.value)) {
      const cleansUp = !inputType || inputType === 'insertReplacementText' || inputType === 'insertFromDrop';
      const replacement = cleansUp ? normalizePhone(input, input.value) : lastPhoneValues.get(input) ?? '';
      accepted = replacement !== null;
      input.value = replacement ?? '';
    }
    lastPhoneValues.set(input, input.value);
    return accepted;
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
    bookingForm.querySelectorAll(`input[data-phone-country-code]${FIELD_SELECTOR}`).forEach((input) => {
      sanitizePhone(input);
    });
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

    const phoneRejected = isPhoneField(input) && !sanitizePhone(input, event.inputType);
    if (input.type === 'date') syncDateHidden(input);

    // Clear an error as soon as the field is fixed; otherwise only flag it
    // mid-typing when it is already definitely wrong.
    if (phoneRejected) {
      setFieldError(input, input.dataset.invalidMessage);
    } else if (input.getAttribute('aria-invalid') === 'true' || shouldValidateInstantly(input)) {
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

  // Block a typed character that can't be part of a valid phone number
  // (a letter, a 9th digit, a "+" that isn't first, another country code).
  document.addEventListener('beforeinput', (event) => {
    const input = event.target;
    if (!isPhoneField(input) || event.inputType !== 'insertText' || input.selectionStart === null) return;
    const { value, selectionStart, selectionEnd } = input;
    const next = value.slice(0, selectionStart) + (event.data || '') + value.slice(selectionEnd);
    if (!isPhoneInProgress(input, next)) event.preventDefault();
  });

  // Pasting is handled here so "+65 8123 4567" or "8123-4567" can be cleaned
  // up instead of being cut short by `maxlength`.
  document.addEventListener('paste', (event) => {
    const input = event.target;
    if (!isPhoneField(input)) return;
    event.preventDefault();

    const pasted = event.clipboardData?.getData('text') || '';
    const { value, selectionStart, selectionEnd } = input;
    const normalized = normalizePhone(input, value.slice(0, selectionStart) + pasted + value.slice(selectionEnd));
    if (normalized === null) {
      setFieldError(input, input.dataset.invalidMessage);
      return;
    }
    input.value = normalized;
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
