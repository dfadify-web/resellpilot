import { describe, expect, it } from 'vitest';
import {
  detectDelimiter,
  formatDecimal,
  parseCsv,
  parseDateInput,
  parseDecimal,
  stringifyCsv,
  toDateInputValue,
} from '../src';

describe('parseCsv', () => {
  it('filas simples con LF y CRLF', () => {
    expect(parseCsv('a,b\n1,2\n')).toEqual([['a', 'b'], ['1', '2']]);
    expect(parseCsv('a,b\r\n1,2\r\n')).toEqual([['a', 'b'], ['1', '2']]);
    expect(parseCsv('a,b\n1,2')).toEqual([['a', 'b'], ['1', '2']]);
  });

  it('comillas, comillas dobladas, separador y saltos dentro de comillas', () => {
    expect(parseCsv('name,note\n"Polo, azul","dice ""hola"""\n"dos\nlíneas",x')).toEqual([
      ['name', 'note'],
      ['Polo, azul', 'dice "hola"'],
      ['dos\nlíneas', 'x'],
    ]);
  });

  it('separador punto y coma', () => {
    expect(parseCsv('a;b\n"1;5";2,5', ';')).toEqual([['a', 'b'], ['1;5', '2,5']]);
  });

  it('quita el BOM, conserva campos vacíos e ignora líneas vacías', () => {
    expect(parseCsv('\uFEFFa,b,c\n\n1,,3\n\n')).toEqual([['a', 'b', 'c'], ['1', '', '3']]);
    expect(parseCsv('a,b\n,')).toEqual([['a', 'b'], ['', '']]);
    expect(parseCsv('')).toEqual([]);
  });

  it('una comilla en mitad de un campo es literal', () => {
    expect(parseCsv('talla 5" x')).toEqual([['talla 5" x']]);
  });

  it('falla con comillas sin cerrar', () => {
    expect(() => parseCsv('a,b\n"sin cerrar,2')).toThrow(/comillas/);
  });
});

describe('detectDelimiter', () => {
  it('elige el separador más frecuente en la cabecera', () => {
    expect(detectDelimiter('name,cost,stock\n')).toBe(',');
    expect(detectDelimiter('name;cost;stock\n12,5;3,2;x')).toBe(';');
    expect(detectDelimiter('\uFEFFname;cost\n')).toBe(';');
    expect(detectDelimiter('name\nx')).toBe(',');
  });

  it('ignora separadores dentro de comillas', () => {
    expect(detectDelimiter('"a,b,c";d;e\n')).toBe(';');
  });
});

describe('stringifyCsv', () => {
  it('entrecomilla solo lo necesario', () => {
    expect(stringifyCsv([['a', 'b'], ['Polo; azul', 'dice "hola"'], [1.5, null]], ';')).toBe(
      'a;b\r\n"Polo; azul";"dice ""hola"""\r\n1.5;\r\n',
    );
  });

  it('ida y vuelta sin pérdidas', () => {
    const rows = [
      ['name', 'note'],
      ['Polo, azul; "XL"', 'dos\nlíneas'],
      [' con espacios ', ''],
    ];
    for (const delimiter of [',', ';'] as const) {
      expect(parseCsv(stringifyCsv(rows, delimiter), delimiter)).toEqual(rows);
    }
  });
});

describe('decimales', () => {
  it('lee punto y coma decimal', () => {
    expect(parseDecimal('12.5')).toBe(12.5);
    expect(parseDecimal('12,50')).toBe(12.5);
    expect(parseDecimal(' 7 ')).toBe(7);
    expect(parseDecimal('12,50 €')).toBe(12.5);
    expect(parseDecimal('-3,2')).toBe(-3.2);
  });

  it('rechaza lo que no es un número', () => {
    for (const bad of ['', 'abc', '1.234,56', '12,5,3', '1e3', '--2']) {
      expect(parseDecimal(bad)).toBeNull();
    }
  });

  it('escribe con coma decimal', () => {
    expect(formatDecimal(12.5)).toBe('12,50');
    expect(formatDecimal(0.856, 4)).toBe('0,8560');
    expect(formatDecimal(null)).toBe('');
  });
});

describe('fechas', () => {
  it('AAAA-MM-DD y DD/MM/AAAA caen en el mismo día local', () => {
    for (const input of ['2026-11-09', '09/11/2026', '9/11/2026']) {
      const iso = parseDateInput(input);
      expect(iso).not.toBeNull();
      expect(toDateInputValue(iso as string)).toBe('2026-11-09');
    }
  });

  it('fecha-hora ISO se normaliza a UTC', () => {
    expect(parseDateInput('2026-11-09T21:20:19.348Z')).toBe('2026-11-09T21:20:19.348Z');
    expect(parseDateInput('2026-11-09T10:00:00+01:00')).toBe('2026-11-09T09:00:00.000Z');
  });

  it('rechaza fechas imposibles o con otro formato', () => {
    for (const bad of ['', 'ayer', '2026-02-31', '31/02/2026', '2026-13-01', '11-09-2026', '2026-11-09T99:00']) {
      expect(parseDateInput(bad)).toBeNull();
    }
  });

  it('toDateInputValue devuelte vacío si la fecha no es válida', () => {
    expect(toDateInputValue('nada')).toBe('');
  });
});
