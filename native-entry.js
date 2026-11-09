import { Capacitor, registerPlugin } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';

const BackgroundGeolocation = registerPlugin('BackgroundGeolocation');
window.Capacitor = Capacitor;

window.MRRNativeGPS = {
  async prepare() {
    try {
      const permission = await LocalNotifications.checkPermissions();
      if (permission.display !== 'granted') {
        await LocalNotifications.requestPermissions();
      }
    } catch (error) {
      console.warn('No se pudo solicitar permiso de notificaciones:', error);
    }
  },
  addWatcher(options, callback) {
    return BackgroundGeolocation.addWatcher(options, callback);
  },
  removeWatcher(id) {
    return BackgroundGeolocation.removeWatcher({ id });
  }
};

window.MRRNativeGPS.prepare().finally(() => {
  import('./app.js').catch(error => {
    console.error('No se pudo iniciar Mallorca Riders:', error);
    document.body.innerHTML = '<main style="padding:24px;font-family:sans-serif"><h2>No se pudo iniciar Mallorca Riders</h2><p>Actualiza la aplicación o contacta con el equipo.</p></main>';
  });
});
