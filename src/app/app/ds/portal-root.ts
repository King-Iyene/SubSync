// Where a floating layer (the records panel, a menu, the account list, a preview) is drawn. The light or dark theme is a class on the app's own wrapper
// (`.dark` on the element with data-theme), not on the page, so a layer drawn straight into the page body would always come out light, white on a dark app.
// Drawing it inside the wrapper gives it the same theme, brand colours and fonts as everything around it; it is still `position: fixed`, so it covers the window.
export function portalRoot(): HTMLElement {
  return (document.querySelector("[data-theme]") as HTMLElement | null) ?? document.body;
}
