const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = __dirname;
const agents = fs.readFileSync(path.join(root, 'AGENTES.md'), 'utf8');
const decisions = JSON.parse(fs.readFileSync(path.join(root, 'decisiones.yml'), 'utf8'));

function validateGovernance(policy, localRules) {
  assert.equal(policy.version, 1);
  assert.equal(policy.review_round_limit, 3);
  assert.ok(Array.isArray(policy.decisions));
  const byId = new Map();
  for (const decision of policy.decisions) {
    assert.ok(decision && typeof decision === 'object');
    assert.equal(typeof decision.id, 'string');
    assert.match(decision.id, /^D-[0-9]{3,}$/, 'Factory policy ID format');
    assert.equal(typeof decision.text, 'string');
    assert.ok(decision.text.length > 20);
    assert.equal(decision.status, 'active');
    assert.equal(byId.has(decision.id), false, 'duplicate owner decision');
    byId.set(decision.id, decision.text);
  }
  for (const id of ['D-054', 'D-055', 'D-056', 'D-057', 'D-058', 'D-059',
    'D-060', 'D-061', 'D-062']) {
    assert.ok(byId.has(id), 'missing owner decision ' + id);
  }
  assert.match(byId.get('D-060'), /extensi[oó]n Chrome\/Safari/);
  assert.match(byId.get('D-060'), /no equivale a smoke/);
  assert.match(byId.get('D-059'),
    /borrar sitios, bases de datos o archivos requiere autorización explícita del dueño/);
  assert.equal(byId.get('D-061'),
    'El puente con ControlBot permanece sin tráfico real, pairing o tratamientos reales hasta consentimiento autenticado, controles de seguridad y puerta legal ControlBot#20; go-live no se presume por merge.');
  assert.match(byId.get('D-062'), /reversible/);
  assert.match(localRules,
    /https:\/\/github\.com\/pl0n3r\/factory\/blob\/v1\/agentes\/NUCLEO\.md/);
  assert.match(localRules, /Node/);
  assert.match(localRules, /Chrome\/Safari/);
  assert.match(localRules, /estado: reservado/);
  assert.match(localRules, /ControlBot#20/);
  assert.match(localRules, /CI verde sin smoke NO acredita/);
  assert.ok(localRules.includes("- **Production green de AutoFactory:** usar definición de extensión en `PLAN-AGENTES.md`, nunca inventar `/health`, despliegue de Hostinger o base de datos para un navegador."),
    'extension must not require HTTP deployment or server health');
}
validateGovernance(decisions, agents);
assert.throws(() => validateGovernance(
  { ...decisions, review_round_limit: 4 }, agents
), /3/);
assert.throws(() => validateGovernance(
  { ...decisions, decisions: decisions.decisions.filter(row => row.id !== 'D-061') },
  agents
), /missing owner decision/);
assert.throws(() => validateGovernance(
  decisions, agents.replace('blob/v1/agentes/NUCLEO.md', 'blob/main/other.md')
), /NUCLEO/);
assert.throws(() => validateGovernance(
  { ...decisions, decisions: [...decisions.decisions, decisions.decisions[0]] },
  agents
), /duplicate owner decision/);
assert.throws(() => validateGovernance(
  { ...decisions, decisions: [{ ...decisions.decisions[0], id: 'D-AF-001' },
    ...decisions.decisions.slice(1)] }, agents
), /Factory policy ID format/);
assert.throws(() => validateGovernance(
  { ...decisions, decisions: decisions.decisions.map(row =>
    row.id === 'D-061' ? { ...row, text:
      'Go-live permitido sin revisión legal ControlBot#20; consentimiento autenticado opcional.' } : row
  ) }, agents
), /puente con ControlBot/);
assert.throws(() => validateGovernance(
  { ...decisions, decisions: decisions.decisions.map(row =>
    row.id === 'D-059' ? { ...row, text: row.text.replace(
      'borrar sitios, bases de datos o archivos requiere autorización explícita del dueño',
      'borrados irreversibles requieren autorización explícita'
    ) } : row
  ) }, agents
), /borrar sitios, bases de datos o archivos/);
assert.throws(() => validateGovernance(
  decisions, agents.replace(
    'nunca inventar `/health`, despliegue de Hostinger o base de datos para un navegador.',
    'hacer deploy HTTP en Hostinger y verificar `/health` para la extensión.'
  )
), /extension must not require HTTP deployment or server health/);
console.log('Factory governance: versioned nucleus, decisions and no-go-live gate verified');
