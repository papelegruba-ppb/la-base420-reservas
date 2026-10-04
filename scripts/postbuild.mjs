import { copyFileSync, existsSync } from 'node:fs';

const origen = 'dist/index.html';
if (!existsSync(origen)) {
  console.error('postbuild: no existe dist/index.html (¿falló vite build?)');
  process.exit(1);
}
// GitHub Pages sirve 404.html en cualquier ruta inexistente (/reservar, /mis-reservas…),
// y al ser la propia SPA, React Router resuelve la ruta en el navegador.
copyFileSync(origen, 'dist/404.html');
console.log('postbuild: dist/404.html generado');
