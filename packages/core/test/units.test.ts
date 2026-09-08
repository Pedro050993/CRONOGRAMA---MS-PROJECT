import { describe, expect, it } from 'vitest';
import {
  convert, IncompatibleUnitsError, parseNominalDiameterInches, sumMeasures, UnknownUnitError,
} from '../src/units/index.js';

describe('unidades — recusa somar o que nao se soma', () => {
  it('converte dentro da mesma grandeza', () => {
    expect(convert(1, 't', 'kg')).toBe(1000);
    expect(convert(2540, 'mm', 'in')).toBeCloseTo(100, 6);
  });

  it('recusa converter entre grandezas diferentes', () => {
    expect(() => convert(10, 'kg', 'm')).toThrow(IncompatibleUnitsError);
    expect(() => convert(10, 'jt', 'un')).toThrow(IncompatibleUnitsError);
  });

  it('recusa converter polegada-diametro em polegada-junta sem regra', () => {
    expect(() => convert(100, 'in-dia', 'in-jt')).toThrow(IncompatibleUnitsError);
  });

  it('recusa somar medidas de grandezas distintas em vez de ignorar o item', () => {
    expect(() => sumMeasures([{ qty: 10, unit: 'm' }, { qty: 5, unit: 'kg' }], 'm'))
      .toThrow(IncompatibleUnitsError);
  });

  it('soma corretamente quando a grandeza e a mesma', () => {
    expect(sumMeasures([{ qty: 1, unit: 'km' }, { qty: 500, unit: 'm' }], 'm')).toEqual({ qty: 1500, unit: 'm' });
  });

  it('rejeita unidade desconhecida', () => {
    expect(() => convert(1, 'pol-junta-maluca', 'm')).toThrow(UnknownUnitError);
  });

  it('interpreta rotulos de diametro usuais de projeto', () => {
    expect(parseNominalDiameterInches('6"')).toBe(6);
    expect(parseNominalDiameterInches('DN150')).toBe(6);
    expect(parseNominalDiameterInches('1 1/2"')).toBe(1.5);
    expect(parseNominalDiameterInches('3/4"')).toBe(0.75);
    expect(parseNominalDiameterInches('600')).toBe(24);
    expect(parseNominalDiameterInches('24')).toBe(24);
  });

  it('devolve null em vez de chutar quando o rotulo e ilegivel', () => {
    expect(parseNominalDiameterInches('??')).toBeNull();
    expect(parseNominalDiameterInches('')).toBeNull();
    expect(parseNominalDiameterInches(undefined)).toBeNull();
  });
});
