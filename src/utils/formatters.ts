export function formatPrice(text: string | null | undefined): string {
  if (!text) return '';
  return text.replace(/[^\d]/g, '');
}

export function extractFirstWord(text: string | null | undefined): string {
  if (!text) return '';
  return text.trim().split(/\s+/)[0] || '';
}

export function formatCentrisNumber(text: string | null | undefined): string {
  if (!text) return '';

  const digitsOnly = text.replace(/\D/g, '');
  if (!digitsOnly) return '';

  const firstSeven = digitsOnly.slice(0, 7);
  const nextSeven = digitsOnly.slice(7, 14);

  return nextSeven ? `${firstSeven}, ${nextSeven}` : firstSeven;
}

export function parseStreetAddress(text: string | null | undefined) {
  if (!text) return { streetNumber: '', streetName: '', appartment: '' };
  
  const trimmed = text.trim();
  const parts = trimmed.split(/\s+/);
  
  const streetNumber = parts[0] || '';
  let rest = parts.slice(1).join(' ');
  
  let streetName = rest;
  let appartment = '';
  
  // check for "app." (case insensitive)
  const appIndex = rest.toLowerCase().indexOf('app.');
  if (appIndex !== -1) {
    streetName = rest.substring(0, appIndex).trim();
    // Clean up trailing commas if any
    streetName = streetName.replace(/,$/, '').trim();
    appartment = rest.substring(appIndex + 4).trim();
  }
  
  return { streetNumber, streetName, appartment };
}

export function parseCityAndZip(text: string | null | undefined) {
  if (!text) return { city: '', zip: '' };
  
  const trimmed = text.trim();
  // Regex looks for Canadian postal code like "H1A 2B3" or "H1A2B3" at the very end of the string
  const zipRegex = /([A-Za-z]\d[A-Za-z]\s?\d[A-Za-z]\d)$/;
  const match = trimmed.match(zipRegex);
  
  if (match) {
    const zip = match[1];
    let city = trimmed.substring(0, match.index).trim();
    // cleanup trailing commas from city just in case
    city = city.replace(/,$/, '').trim();
    return { city, zip };
  }
  
  return { city: trimmed, zip: '' };
}

export function parseFullName(text: string | null | undefined) {
  if (!text) return { firstName: 'NF', lastName: 'NF' };
  
  // Remove trailing content in parenthesis, e.g. "John Doe (Broker)"
  const noBracket = text.split('(')[0].trim();
  const parts = noBracket.split(/\s+/);
  
  const firstName = parts[0] || 'NF';
  const lastName = parts.slice(1).join(' ') || 'NF';
  
  return { firstName, lastName };
}
