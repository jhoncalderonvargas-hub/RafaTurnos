import {
  coincideBusquedaCampos,
  dividirTerminosBusqueda,
  normalizarTextoBusqueda,
} from './busqueda-texto';

describe('busqueda-texto helper', () => {
  it('normaliza tildes, mayusculas y espacios multiples sin perder consistencia', () => {
    expect(normalizarTextoBusqueda('  Mónica   María  Pérez  ')).toBe('monica maria perez');
    expect(normalizarTextoBusqueda('MUÑOZ ÓSCAR')).toBe('munoz oscar');
    expect(normalizarTextoBusqueda(null)).toBe('');
    expect(normalizarTextoBusqueda(undefined)).toBe('');
    expect(normalizarTextoBusqueda(12345)).toBe('12345');
  });

  it('encuentra nombres con tildes aunque el usuario busque sin tilde', () => {
    const terminos = dividirTerminosBusqueda('monica');
    expect(
      coincideBusquedaCampos(terminos, ['Mónica Sofía Gutiérrez', '1040123456', 'Auxiliar'])
    ).toBeTrue();
  });

  it('soporta multiples palabras ignorando segundo nombre o cruzando campos', () => {
    const terminosNombre = dividirTerminosBusqueda('monica gutierrez');
    expect(
      coincideBusquedaCampos(terminosNombre, ['Mónica Sofía Gutiérrez', '1040123456', 'Auxiliar'])
    ).toBeTrue();

    const terminosCruzados = dividirTerminosBusqueda('monica urgencias');
    expect(
      coincideBusquedaCampos(terminosCruzados, ['Mónica Sofía', '1040123456', 'Enfermería', 'Urgencias'])
    ).toBeTrue();

    const terminosNoMatch = dividirTerminosBusqueda('monica pediatria');
    expect(
      coincideBusquedaCampos(terminosNoMatch, ['Mónica Sofía', '1040123456', 'Enfermería', 'Urgencias'])
    ).toBeFalse();
  });

  it('retorna true cuando la consulta esta vacia', () => {
    expect(coincideBusquedaCampos(dividirTerminosBusqueda('   '), ['Cualquier Nombre'])).toBeTrue();
  });
});
