// The filter panels on the episodes and films lists. On phones, everything but the search box
// sits in a bottom sheet (a modal <dialog>) behind a Filters button; on wider screens the same
// dialog is left open and its controls sit in the filter row (see .sheet in global.css).
export const PHONE = '(max-width: 40rem)';

// Keeps the dialog in the right state for the screen width. Call from onMount; returns the cleanup.
export function fitFilterSheet(sheet: HTMLDialogElement) {
	const phone = matchMedia(PHONE);
	const fit = () => {
		if (sheet.matches(':modal')) {
			if (!phone.matches) sheet.close();
			else return;
		}
		// Set the attribute rather than calling show(), which would move focus into the filters on load.
		sheet.toggleAttribute('open', !phone.matches);
	};
	sheet.addEventListener('close', fit);
	phone.addEventListener('change', fit);
	fit();
	return () => {
		sheet.removeEventListener('close', fit);
		phone.removeEventListener('change', fit);
	};
}

// Tapping the backdrop (the dialog element itself, outside its content) closes the sheet.
export function closeOnBackdrop(event: MouseEvent) {
	const sheet = event.currentTarget as HTMLDialogElement;
	if (event.target === sheet && sheet.matches(':modal')) sheet.close();
}
