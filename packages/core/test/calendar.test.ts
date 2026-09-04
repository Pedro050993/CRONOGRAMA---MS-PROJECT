import { describe, expect, it } from 'vitest';
import {
  addWorkingMinutes, isWorkingDay, nextWorkingInstant, standardCalendar,
  subtractWorkingMinutes, workingMinutesBetween, workingMinutesOnDay, type WorkCalendar,
} from '../src/calendar/index.js';

const cal = standardCalendar();
const withHoliday: WorkCalendar = {
  ...cal,
  exceptions: [{ date: '2026-01-08', working: false, name: 'Feriado de teste' }],
};

describe('calendario de trabalho', () => {
  it('5x8 padrao tem 480 minutos por dia util e zero no fim de semana', () => {
    expect(workingMinutesOnDay(cal, new Date('2026-01-05T00:00:00Z'))).toBe(480); // segunda
    expect(workingMinutesOnDay(cal, new Date('2026-01-10T00:00:00Z'))).toBe(0);   // sabado
    expect(isWorkingDay(cal, new Date('2026-01-11T00:00:00Z'))).toBe(false);      // domingo
  });

  it('empurra o inicio para o proximo turno quando cai fora do expediente', () => {
    const r = nextWorkingInstant(cal, new Date('2026-01-05T22:00:00Z'));
    expect(r.toISOString()).toBe('2026-01-06T07:00:00.000Z');
  });

  it('pula o intervalo de almoco ao somar duracao', () => {
    // 07:00 + 6h uteis: 5h ate 12:00, 1h restante de 13:00 a 14:00
    const r = addWorkingMinutes(cal, new Date('2026-01-05T07:00:00Z'), 6 * 60);
    expect(r.toISOString()).toBe('2026-01-05T14:00:00.000Z');
  });

  it('atravessa o fim de semana', () => {
    // sexta 07:00 + 16h uteis = 2 dias uteis -> segunda 16:00
    const r = addWorkingMinutes(cal, new Date('2026-01-09T07:00:00Z'), 16 * 60);
    expect(r.toISOString()).toBe('2026-01-12T16:00:00.000Z');
  });

  it('respeita feriado cadastrado como excecao', () => {
    // quarta 07/01 07:00 + 8h -> normalmente 07/01 16:00; com feriado em 08/01
    // um trabalho de 16h vai para 09/01
    const semFeriado = addWorkingMinutes(cal, new Date('2026-01-07T07:00:00Z'), 16 * 60);
    const comFeriado = addWorkingMinutes(withHoliday, new Date('2026-01-07T07:00:00Z'), 16 * 60);
    expect(semFeriado.toISOString()).toBe('2026-01-08T16:00:00.000Z');
    expect(comFeriado.toISOString()).toBe('2026-01-09T16:00:00.000Z');
  });

  it('subtracao e a inversa da soma', () => {
    const start = new Date('2026-01-06T09:00:00Z');
    const end = addWorkingMinutes(cal, start, 13 * 60);
    expect(subtractWorkingMinutes(cal, end, 13 * 60).toISOString()).toBe(start.toISOString());
  });

  it('conta apenas minutos uteis entre dois instantes', () => {
    expect(workingMinutesBetween(cal, new Date('2026-01-05T07:00:00Z'), new Date('2026-01-06T07:00:00Z'))).toBe(480);
    expect(workingMinutesBetween(cal, new Date('2026-01-10T00:00:00Z'), new Date('2026-01-12T00:00:00Z'))).toBe(0);
  });
});
