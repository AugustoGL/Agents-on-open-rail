// Interacciones de la guía de estilos (el sistema de diseño en sí no necesita JavaScript).
const root = document.documentElement;
document.querySelector('#tema').addEventListener('change', (e) => {
  if (e.target.value) root.dataset.theme = e.target.value;
  else delete root.dataset.theme;
});

// Botones que se marcan al tocarlos (días, turnos, pestañas).
for (const group of document.querySelectorAll('.dias, .pestanas')) {
  group.addEventListener('click', (e) => {
    const b = e.target.closest('button[aria-pressed]');
    if (!b) return;
    for (const other of group.querySelectorAll('button[aria-pressed]')) other.setAttribute('aria-pressed', String(other === b));
  });
}
for (const turno of document.querySelectorAll('.turno[aria-pressed]')) {
  turno.addEventListener('click', () => turno.setAttribute('aria-pressed', String(turno.getAttribute('aria-pressed') !== 'true')));
}

// Estado "cargando" de un botón.
const demo = document.querySelector('#demo-btn-cargar');
demo.addEventListener('click', () => {
  demo.setAttribute('aria-busy', 'true');
  setTimeout(() => demo.removeAttribute('aria-busy'), 2000);
});

// Ventana de verdad (con Escape y foco).
document.querySelector('#demo-modal').addEventListener('click', (e) => {
  const opener = e.currentTarget;
  const close = () => { fondo.remove(); document.removeEventListener('keydown', onKey); opener.focus(); };
  const onKey = (ev) => { if (ev.key === 'Escape') close(); };
  const fondo = document.createElement('div');
  fondo.className = 'modal-fondo';
  fondo.addEventListener('click', (ev) => { if (ev.target === fondo) close(); });
  const modal = document.createElement('div');
  modal.className = 'modal pila';
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-label', 'Ejemplo de ventana');
  const titulo = document.createElement('h3');
  titulo.textContent = 'Así se ve una ventana';
  const texto = document.createElement('p');
  texto.textContent = 'En el celular sube desde abajo; en pantallas grandes aparece al medio. Se cierra con Escape o tocando afuera.';
  const cerrar = document.createElement('button');
  cerrar.className = 'btn btn-primario btn-bloque';
  cerrar.type = 'button';
  cerrar.textContent = 'Entendido';
  cerrar.addEventListener('click', close);
  modal.append(titulo, texto, cerrar);
  fondo.append(modal);
  document.body.append(fondo);
  document.addEventListener('keydown', onKey);
  cerrar.focus();
});
