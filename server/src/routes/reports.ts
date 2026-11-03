import { Router } from 'express';
import { addDays, reportQuerySchema } from '@flagtrack/shared';
import { HttpError, ah, parse } from '../http';
import { collectReportData, reportFileName } from '../reports/data';
import { renderPdf } from '../reports/pdf';
import { renderXlsx } from '../reports/xlsx';

export const reportsRouter = Router();

async function load(req: Parameters<Parameters<typeof ah>[0]>[0]) {
  const q = parse(reportQuerySchema, req.query);
  if (q.to < q.from) throw new HttpError(400, 'O fim do período deve ser depois do início.', 'VALIDATION');
  if (addDays(q.from, 366) < q.to) throw new HttpError(400, 'Selecione um período de até 1 ano.', 'VALIDATION');
  if (!q.modules.length) throw new HttpError(400, 'Selecione ao menos um módulo.', 'VALIDATION');
  return { q, data: await collectReportData(req.userId, q.from, q.to, q.modules) };
}

reportsRouter.get('/pdf', ah(async (req, res) => {
  const { q, data } = await load(req);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${reportFileName(q.from, q.to, 'pdf')}"`);
  renderPdf(data, (doc) => doc.pipe(res));
}));

reportsRouter.get('/xlsx', ah(async (req, res) => {
  const { q, data } = await load(req);
  const buf = await renderXlsx(data);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${reportFileName(q.from, q.to, 'xlsx')}"`);
  res.send(Buffer.from(buf));
}));
