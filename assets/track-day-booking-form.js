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

  // A phone field holding only its fixed prefix (e.g. "+65") counts as empty.
  const isEmpty = (input) => !input.value.trim() || input.value === input.dataset.phonePrefix;

  const getFieldError = (input) => {
    const { validity, dataset } = input;
    // A partially typed / impossible date (e.g. a 6-digit year) reports
    // badInput with an empty value, so check it before "required".
    if (validity.badInput) return dataset.invalidMessage;
    if (isEmpty(input)) return dataset.requiredMessage;
    if (validity.rangeUnderflow && dataset.underflowMessage) return dataset.underflowMessage;
    if (validity.rangeOverflow && dataset.overflowMessage) return dataset.overflowMessage;
    if (!input.checkValidity()) return dataset.invalidMessage || dataset.requiredMessage;
    return '';
  };

  // Show an error while typing only when waiting for blur would be pointless:
  // a date (a picker choice or typed date is a complete action).
  const shouldValidateInstantly = (input) => input.type === 'date';

  // Last sanitized value of each phone field, used to undo deletes into the prefix.
  const lastPhoneValues = new WeakMap();

  // A number with another country code, e.g. "+971 …" when the prefix is "+65".
  const isForeignPhone = (input, text) => {
    const prefix = input.dataset.phonePrefix || '';
    const trimmed = text.trim();
    return trimmed.startsWith('+') && !trimmed.startsWith(prefix);
  };

  // Builds "<prefix><digits>" from raw text: keeps the fixed prefix (e.g. "+65"),
  // drops non-digits, removes a repeated country code from numbers such as
  // "+65 8123 4567" or "0065 8123 4567", and caps the local number at
  // data-phone-digits. Another country's number is dropped rather than being
  // truncated into a wrong local number.
  const normalizePhone = (input, raw) => {
    const prefix = input.dataset.phonePrefix || '';
    const maxDigits = Number(input.dataset.phoneDigits) || Infinity;
    const countryCode = prefix.replace(/\D/g, '');

    const rest = raw.startsWith(prefix) ? raw.slice(prefix.length) : raw;
    if (isForeignPhone(input, rest)) return prefix;

    let digits = rest.replace(/\D/g, '');
    const repeatedCode = [`00${countryCode}`, countryCode].find(
      (code) => countryCode && digits.length > maxDigits && digits.startsWith(code)
    );
    if (repeatedCode) digits = digits.slice(repeatedCode.length);
    return prefix + digits.slice(0, maxDigits);
  };

  // A delete that reached into the prefix (e.g. Backspace right after "+65")
  // keeps the prefix and only removes the digits that were deleted.
  const restorePhonePrefix = (input, previous) => {
    const prefix = input.dataset.phonePrefix || '';
    const { value } = input;
    let start = 0;
    while (start < value.length && value[start] === previous[start]) start++;
    const end = start + previous.length - value.length;
    return prefix + previous.slice(Math.max(end, prefix.length));
  };

  const sanitizePhone = (input, inputType = '') => {
    const prefix = input.dataset.phonePrefix || '';
    const previous = lastPhoneValues.get(input);
    const sanitized =
      inputType.startsWith('delete') && previous && !input.value.startsWith(prefix)
        ? restorePhonePrefix(input, previous)
        : normalizePhone(input, input.value);
    if (sanitized !== input.value) input.value = sanitized;
    lastPhoneValues.set(input, sanitized);
  };

  // Keeps the caret (and selection start) after the fixed prefix.
  const clampPhoneCaret = (input) => {
    const prefixLength = (input.dataset.phonePrefix || '').length;
    if (input.selectionStart === null || input.selectionStart >= prefixLength) return;
    input.setSelectionRange(prefixLength, Math.max(prefixLength, input.selectionEnd));
  };

  const isPhoneField = (input) => input.matches?.(`input[data-phone-prefix]${FIELD_SELECTOR}`);

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

    // Restore the fixed prefix if the browser restored or autofilled a value without it.
    bookingForm.querySelectorAll('input[data-phone-prefix]').forEach(sanitizePhone);
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

    if (isPhoneField(input)) sanitizePhone(input, event.inputType);
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
    if (!input.matches?.(FIELD_SELECTOR) || (isEmpty(input) && !input.validity.badInput)) return;
    setFieldError(input, getFieldError(input));
  });

  // Pasting is handled here because `maxlength` would otherwise cut a pasted
  // "+65 8123 4567" short before it could be cleaned up.
  document.addEventListener('paste', (event) => {
    const input = event.target;
    if (!isPhoneField(input)) return;
    event.preventDefault();

    const pasted = event.clipboardData?.getData('text') || '';
    // Reject another country's number instead of truncating it into a wrong one.
    if (isForeignPhone(input, pasted)) {
      setFieldError(input, input.dataset.invalidMessage);
      return;
    }

    clampPhoneCaret(input);
    const { value, selectionStart, selectionEnd } = input;
    input.value = normalizePhone(input, value.slice(0, selectionStart) + pasted + value.slice(selectionEnd));
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });

  // Stop the caret from moving into (and editing) the fixed prefix.
  ['focusin', 'click', 'keyup', 'select'].forEach((type) => {
    document.addEventListener(type, (event) => {
      if (isPhoneField(event.target)) clampPhoneCaret(event.target);
    });
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
