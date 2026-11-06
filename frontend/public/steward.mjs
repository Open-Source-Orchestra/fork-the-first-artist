const WORKER = 'https://oso-zerog-steward.shakaverse.workers.dev';
const form = document.querySelector('#steward-form');
const fields = document.querySelector('#steward-fields');
const question = document.querySelector('#steward-question');
const button = document.querySelector('#ask-steward');
const serviceStatus = document.querySelector('#service-status');
const answerStatus = document.querySelector('#answer-status');
const card = document.querySelector('#answer-card');

try {
  const response = await fetch(`${WORKER}/health`, { cache: 'no-store', signal: AbortSignal.timeout(10_000) });
  const health = await response.json();
  if (!response.ok || !health.ok || health.provider !== '0g' || health.payment !== false || health.selfFunding !== false) throw new Error('unhealthy');
  serviceStatus.textContent = `Live: ${health.inference} on ${health.network}. ${health.model}. No payment or self-funding claim.`;
  fields.disabled = false;
  question.focus();
} catch {
  serviceStatus.textContent = 'The live steward is unavailable. No mock answer will be substituted.';
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const instruction = question.value.trim();
  if (!instruction || instruction.length > 280) {
    answerStatus.textContent = 'Enter a question of 1–280 characters.';
    question.focus();
    return;
  }
  fields.disabled = true;
  button.textContent = 'Asking through 0G…';
  card.hidden = true;
  answerStatus.textContent = 'Waiting for real 0G inference. This can take a few seconds.';
  try {
    const response = await fetch(`${WORKER}/ask`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ instruction }),
      signal: AbortSignal.timeout(75_000),
    });
    const body = await response.json();
    if (!response.ok || !body.ok || !body.reply?.text || !body.proof?.requestId) throw new Error('degraded');
    const proof = body.proof;
    document.querySelector('#answer-text').textContent = body.reply.text;
    document.querySelector('#request-id').textContent = proof.requestId;
    document.querySelector('#verification-id').textContent = proof.verificationChatId ?? '(not supplied)';
    document.querySelector('#provider-id').textContent = proof.providerAddress ?? '(not supplied)';
    document.querySelector('#model-id').textContent = proof.model ?? proof.requestedModel;
    const micro = Number(proof.billingMicro);
    document.querySelector('#billing-cost').textContent = Number.isFinite(micro) ? `$${(micro / 1_000_000).toFixed(6)} USD` : '(not supplied)';
    card.hidden = false;
    answerStatus.textContent = 'Real 0G answer and request metadata received.';
    document.querySelector('#answer-heading').focus?.();
  } catch {
    answerStatus.textContent = 'Real 0G inference failed or returned an unusable answer. No mock answer was substituted. Please try again shortly.';
  } finally {
    fields.disabled = false;
    button.textContent = 'Ask through real 0G';
    question.focus();
  }
});
