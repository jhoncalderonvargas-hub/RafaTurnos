import {
  HttpErrorResponse,
  HttpInterceptorFn,
  HttpResponse,
} from '@angular/common/http';
import { catchError, tap, throwError } from 'rxjs';

const STORAGE_KEY_TOKEN = 'rafa_turnos_sso_jwt';
const STORAGE_KEY_INTRANET_URL = 'rafa_turnos_intranet_url';

/**
 * Interceptor HTTP de Seguridad Satélite SSO:
 * 1. Adjunta automáticamente `Authorization: Bearer <sessionToken>` a todas las peticiones HTTP.
 * 2. Si el Backend emite `x-renewed-token` (Sliding Session por actividad), actualiza el token en sessionStorage.
 * 3. Si el Backend responde `401 Unauthorized` (token expirado o inválido), limpia la sesión y redirige a la Intranet.
 */
export const ssoAuthInterceptor: HttpInterceptorFn = (req, next) => {
  let peticion = req;

  try {
    const token = sessionStorage.getItem(STORAGE_KEY_TOKEN);
    if (token && !req.headers.has('Authorization')) {
      peticion = req.clone({
        setHeaders: {
          Authorization: `Bearer ${token}`,
        },
      });
    }
  } catch {}

  return next(peticion).pipe(
    tap((event) => {
      if (event instanceof HttpResponse) {
        const tokenRenovado = event.headers.get('x-renewed-token');
        if (tokenRenovado) {
          try {
            sessionStorage.setItem(STORAGE_KEY_TOKEN, tokenRenovado);
          } catch {}
        }
      }
    }),
    catchError((error: unknown) => {
      if (
        error instanceof HttpErrorResponse &&
        error.status === 401 &&
        !req.url.includes('/intranet/sso-login')
      ) {
        try {
          sessionStorage.removeItem(STORAGE_KEY_TOKEN);
          const destino =
            sessionStorage.getItem(STORAGE_KEY_INTRANET_URL) ||
            'http://localhost:4300';
          window.location.href = destino;
        } catch {}
      }
      return throwError(() => error);
    })
  );
};
