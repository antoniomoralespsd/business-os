import { ClientSchema, DEFAULT_CLIENT_MODULES, type Client } from '@bos/schemas';
import { addDays, startOfWeek, todayISO } from '@bos/domain';
import type { Data } from './db';
import type { MemoryDb } from './memoryDb';

/** Starting clients (also created in Firestore on the very first login). */
export const DEMO_CLIENTS: Array<Pick<Client, 'id' | 'name' | 'shortName' | 'aliases' | 'color'>> = [
  { id: 'city-hall', name: 'City Hall', shortName: 'CITY HALL', aliases: ['city', 'ch'], color: 'blue' },
  { id: 'level-bcn', name: 'Level Barcelona', shortName: 'LEVEL BCN', aliases: ['level bcn', 'level barcelona'], color: 'lime' },
  { id: 'level-and', name: 'Level Andorra', shortName: 'LEVEL AND', aliases: ['level and', 'level andorra'], color: 'teal' },
  { id: 'icon', name: 'Icon', shortName: 'ICON', aliases: [], color: 'cyan' },
  { id: 'otto', name: 'Otto', shortName: 'OTTO', aliases: [], color: 'amber' },
  { id: 'makumba', name: 'Makumba', shortName: 'MAKUMBA', aliases: [], color: 'coral' },
  { id: 'la-cova', name: 'La Cova', shortName: 'LA COVA', aliases: ['cova'], color: 'stone' },
  { id: 'descarada', name: 'Descarada', shortName: 'DESCARADA', aliases: [], color: 'pink' },
  { id: 'bellaka', name: 'Bellaka', shortName: 'BELLAKA', aliases: [], color: 'violet' },
  { id: 'esb', name: 'Espacios Singulares', shortName: 'ESP. SINGULARES', aliases: ['espacios singulares', 'esb'], color: 'ink' },
  { id: 'paradise', name: 'Paradise London', shortName: 'PARADISE', aliases: ['paradise', 'paradise london'], color: 'coral' },
  { id: 'hybrunch', name: 'Hybrunch', shortName: 'HYBRUNCH', aliases: [], color: 'amber' },
];

/** Fills an empty demo DB with a realistic, clearly fictional working state. */
export function seedDemo(db: MemoryDb, ws: string, today = todayISO()) {
  const now = new Date();
  const base = (id: string) => ({ id, workspaceId: ws, createdAt: now, updatedAt: now, createdBy: 'demo' });
  const put = (col: string, id: string, data: Data) => db.writeDoc(`workspaces/${ws}/${col}/${id}`, { ...base(id), ...data });
  const mon = startOfWeek(today);
  const day = (i: number) => addDays(mon, i);

  for (const c of DEMO_CLIENTS) {
    const full = ClientSchema.parse({ ...base(c.id), createdAt: now.toISOString(), updatedAt: now.toISOString(), ...c, modules: [...DEFAULT_CLIENT_MODULES] });
    put('clients', c.id, {
      ...full,
      createdAt: now,
      updatedAt: now,
      billing: { ...full.billing, defaultRate: c.id === 'icon' || c.id === 'city-hall' ? 3000 : 4000 },
      ...(c.id === 'city-hall'
        ? {
            legalName: 'Ejemplo Ocio Nocturno SL',
            taxId: 'B00000000',
            billingEmail: 'facturas@ejemplo.com',
            notes: 'Flyers semanales por sala. Entregar en story 1080×1920 y feed 1080×1350.',
            links: [
              { id: 'l1', label: 'Carpeta de entregas', url: 'https://drive.google.com/', kind: 'drive' },
              { id: 'l2', label: 'Fotos de artistas', url: 'https://www.dropbox.com/', kind: 'dropbox' },
              { id: 'l3', label: 'Instagram', url: 'https://instagram.com/', kind: 'instagram' },
            ],
          }
        : {}),
    });
  }

  // Tasks: the current week
  let n = 0;
  const task = (d: string | null, clientId: string | null, title: string, status = 'pending', extra: Data = {}) => {
    n++;
    put('tasks', `demo-${n}`, {
      title, clientId, description: '', dueDate: d, status, priority: 'normal', order: n * 1024, archived: false,
      completedAt: status === 'completed' ? now : null, reviewStartedAt: status === 'review' ? now : null, jobId: null, ...extra,
    });
  };
  task(day(0), 'level-bcn', 'Flyer viernes', 'completed');
  task(day(0), 'icon', 'Flyer sábado', 'review', { description: 'Mandado por WhatsApp a las 17:30.' });
  task(day(0), 'level-and', 'Flyer sábado sala 2', 'completed');
  task(day(1), 'icon', 'Cambio 11 oct', 'review');
  task(day(1), 'level-bcn', '11 oct', 'changes_requested', { description: 'Cliente quiere versión azul.' });
  task(day(1), 'otto', 'Week', 'completed');
  task(day(2), 'city-hall', 'Cambio voz 31 oct', 'in_progress', { priority: 'high' });
  task(day(2), null, 'FACTURAS', 'pending', { priority: 'high' });
  task(day(2), 'paradise', 'Finde');
  task(day(2), 'hybrunch', '25 oct', 'changes_requested');
  task(day(2), 'city-hall', '20 oct', 'review');
  task(day(3), 'city-hall', '29 oct sala 2');
  task(day(3), 'bellaka', 'Flyer artista', 'pending', { description: 'Esperando confirmación del lineup.' });
  task(day(4), 'city-hall', 'Flyer Halloween', 'pending', { priority: 'high' });
  task(day(5), 'descarada', 'Stories sábado');
  task(null, 'la-cova', 'Renovar logo');
  task(null, null, 'Ordenar carpeta de entregas');

  // Jobs: last month unbilled for two clients
  const lastMonth = addDays(mon, -28);
  let j = 0;
  const job = (clientId: string, date: string, concept: string, unitPrice: number, invoiceId: string | null = null) => {
    j++;
    put('jobs', `job-${j}`, { clientId, date, concept, quantity: 1, unitPrice, invoiceId, taskId: null, archived: false });
  };
  for (let i = 0; i < 4; i++) job('city-hall', addDays(lastMonth, i * 7), `Flyer semana ${i + 1}`, 3000);
  for (let i = 0; i < 3; i++) job('icon', addDays(lastMonth, i * 7 + 2), `Flyer + story ${i + 1}`, 3000);
  job('bellaka', addDays(mon, -3), 'Flyer animado', 6000);

  // One paid invoice from two months ago
  const prev = addDays(mon, -60);
  job('level-bcn', prev, 'Pack flyers mes', 16000, 'inv-demo-1');
  put('invoices', 'inv-demo-1', {
    series: '', number: 1, invoiceNumber: `${prev.slice(0, 4)}-001`, clientId: 'level-bcn',
    client: { name: 'Level Barcelona', legalName: '', taxId: '', address: '', email: '' },
    issuer: { name: 'Iris Design', legalName: 'Nombre de ejemplo', taxId: '00000000T', address: '', email: '' },
    date: prev, dueDate: addDays(prev, 30), lines: [{ jobId: `job-${j}`, date: prev, concept: 'Pack flyers mes', quantity: 1, unitPrice: 16000 }],
    vatRate: 21, irpfRate: 15, subtotal: 16000, tax: 3360, withholding: 2400, total: 16960, status: 'paid',
    sentAt: now, paidAt: addDays(prev, 12), notes: '', external: false, fileId: null, archived: false,
  });

  // Expenses
  const exp = (id: string, date: string, vendor: string, category: string, total: number, status = 'confirmed', extra: Data = {}) => {
    const base = Math.round(total / 1.21);
    put('expenses', id, { date, vendor, vendorTaxId: '', concept: '', invoiceNumber: '', category, base, vatRate: 21, vat: total - base, total, deductible: true, status, subscriptionId: null, clientId: null, fileId: status === 'confirmed' ? 'demo-file' : null, notes: '', archived: false, ...extra });
  };
  exp('exp-1', addDays(mon, -20), 'MediaMarkt', 'hardware', 4999);
  exp('exp-2', addDays(mon, -10), 'Vistaprint', 'impresion', 8650);
  exp('exp-3', addDays(mon, -2), 'Adobe', 'software', 6049, 'pending', { subscriptionId: 'sub-adobe' });

  // Subscriptions
  const sub = (id: string, data: Data) => put('subscriptions', id, {
    vendor: '', plan: '', vatRate: 21, currency: 'EUR', startDate: null, endDate: null, autoRenew: true, remindDaysBefore: 7, account: 'antoniomorales.psd@gmail.com', paymentLabel: '', manageUrl: '', deductible: true, notes: '', lastChargeDate: null, ...data,
  });
  sub('sub-adobe', { name: 'Adobe Creative Cloud', vendor: 'Adobe', category: 'software', plan: 'Todas las apps', amount: 6049, cycle: 'monthly', nextRenewalDate: addDays(today, 3), status: 'active', manageUrl: 'https://account.adobe.com/plans' });
  sub('sub-google', { name: 'Google One 2 TB', vendor: 'Google', category: 'almacenamiento', amount: 9999, cycle: 'yearly', nextRenewalDate: addDays(today, 140), status: 'active' });
  sub('sub-chatgpt', { name: 'ChatGPT Plus', vendor: 'OpenAI', category: 'ia', amount: 2300, cycle: 'monthly', nextRenewalDate: addDays(today, 12), status: 'active' });
  sub('sub-spotify', { name: 'Spotify', vendor: 'Spotify', category: 'musica', amount: 1199, cycle: 'monthly', nextRenewalDate: addDays(today, 20), status: 'active', deductible: false });
  sub('sub-domain', { name: 'Dominio irisdesign', vendor: 'IONOS', category: 'dominio', amount: 1500, cycle: 'yearly', nextRenewalDate: addDays(today, 24), endDate: addDays(today, 24), status: 'active', autoRenew: false });
  sub('sub-figma', { name: 'Figma Professional', vendor: 'Figma', category: 'software', amount: 1500, cycle: 'monthly', nextRenewalDate: null, endDate: addDays(today, 2), status: 'trial' });

  // Issuer (clearly example data)
  db.writeDoc(`workspaces/${ws}/settings/issuer`, {
    name: 'Iris Design', legalName: 'Nombre de ejemplo', taxId: '00000000T', address: 'Calle Ejemplo 1, 08000 Barcelona', email: 'hola@ejemplo.com', phone: '',
    iban: 'ES00 0000 0000 0000 0000 0000', series: '', nextNumber: {}, defaultVat: 21, defaultIrpf: 15, paymentNote: 'Pago por transferencia en 30 días.',
  });
}
