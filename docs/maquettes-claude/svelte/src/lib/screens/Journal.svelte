<script lang="ts">
  import { Logic } from './Journal.logic.svelte';
  import './Journal.css';
  import BottomNav from '$lib/components/BottomNav.svelte';

  const logic = new Logic({});
  const v: Record<string, any> = $derived(logic.renderVals());
</script>

<div class="s-journal screen" style="width:var(--gf-w,390px);height:var(--gf-h,844px);box-sizing:border-box;background:#FFFFFF;display:flex;flex-direction:column;position:relative;overflow:hidden;color:#0F1512;font-family:'Lato',system-ui,sans-serif">

  <div style="padding:52px 20px 0;display:flex;align-items:center;justify-content:space-between;position:relative;z-index:30">
    {#if v.cal}<button aria-label="Fermer le calendrier" onclick={v.toggleCal} style="position:absolute;left:0;top:0;width:390px;height:844px;padding:0;border:0;background:rgba(15,21,18,.18);animation:scrimIn .2s ease-out both"></button>{/if}
    <div style="position:relative;display:flex;align-items:center;gap:2px">
      <button class="press" onclick={v.toggleCal} aria-label="Choisir la date" aria-expanded={v.cal} style="height:48px;padding:0 12px 0 16px;border-radius:24px;border:1px solid #E9EDEA;background:#FFFFFF;box-shadow:0 1px 2px rgba(15,21,18,.04),0 8px 20px -8px rgba(15,21,18,.14);display:flex;align-items:center;gap:6px;font-size:17px;font-weight:900;letter-spacing:-0.02em;color:#0F1512;white-space:nowrap">{v.dayLabel}<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#66716B" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="transform:rotate({v.chevRot}deg);transition:transform .2s ease"><path d="M6 9l6 6 6-6"></path></svg></button>
      <button class="press" aria-label="Jour précédent" onclick={v.prevDay} style="position:relative;width:40px;height:40px;padding:0;border-radius:20px;border:0;background:transparent;color:#4A5550;display:flex;align-items:center;justify-content:center"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7"></path></svg></button><button class="press" aria-label="Jour suivant" onclick={v.nextDay} style="position:relative;width:40px;height:40px;padding:0;border-radius:20px;border:0;background:transparent;color:#4A5550;display:flex;align-items:center;justify-content:center"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 5l7 7-7 7"></path></svg></button>
    </div>
    <button class="press" aria-label="Actualiser" style="position:relative;width:44px;height:44px;padding:0;border-radius:22px;border:1px solid #E9EDEA;background:#FFFFFF;box-shadow:0 1px 2px rgba(15,21,18,.04),0 8px 20px -8px rgba(15,21,18,.14);display:flex;align-items:center;justify-content:center;color:#0F1512">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 11a8 8 0 0 0-14.5-4.2L4 9"></path><path d="M4 4v5h5"></path><path d="M4 13a8 8 0 0 0 14.5 4.2L20 15"></path><path d="M20 20v-5h-5"></path></svg>
    </button>
    {#if v.cal}
      <div role="dialog" aria-label="Calendrier" style="position:absolute;left:20px;right:20px;top:108px;box-sizing:border-box;padding:14px 14px 14px;border-radius:28px;background:#FFFFFF;border:1px solid #EEF1EF;box-shadow:0 30px 60px -18px rgba(15,21,18,.4);transform-origin:top left;animation:popIn .22s cubic-bezier(.2,.8,.2,1) both">
        <div style="display:flex;align-items:center;justify-content:space-between;padding:0 4px 0 10px">
          <div style="font-size:18px;font-weight:900;letter-spacing:-0.02em">{v.monthTitle}</div>
          <div style="display:flex;gap:2px">
            <button class="press" aria-label="Mois précédent" onclick={v.prevMonth} style="width:44px;height:44px;padding:0;border-radius:22px;border:0;background:#F3F6F4;color:#0F1512;display:flex;align-items:center;justify-content:center"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7"></path></svg></button>
            <button class="press" aria-label="Mois suivant" onclick={v.nextMonth} style="width:44px;height:44px;padding:0;border-radius:22px;border:0;background:#F3F6F4;color:#0F1512;display:flex;align-items:center;justify-content:center;margin-left:6px"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 5l7 7-7 7"></path></svg></button>
          </div>
        </div>
        <div style="margin-top:8px;display:grid;grid-template-columns:repeat(7,minmax(0,1fr));text-align:center;font-size:11.5px;font-weight:900;letter-spacing:.08em;color:#7B857F"><span>L</span><span>M</span><span>M</span><span>J</span><span>V</span><span>S</span><span>D</span></div>
        <div style="margin-top:4px;display:grid;grid-template-columns:repeat(7,minmax(0,1fr));row-gap:2px;animation:{v.calAnim} .22s ease-out both">
          {#each v.cells as d}
            <div style="height:44px;display:flex;align-items:center;justify-content:center">
              {#if d.show}<button class="press" onclick={d.pick} aria-label={d.label} aria-pressed={d.sel} style="position:relative;width:40px;height:40px;padding:0;border-radius:20px;border:{d.bd};background:{d.bg};color:{d.fg};font-size:15.5px;font-weight:{d.fw};transition:background-color .18s ease,color .18s ease">{d.n}<span style="position:absolute;left:50%;bottom:4px;margin-left:-2px;width:4px;height:4px;border-radius:2px;background:{d.dot}"></span></button>{/if}
            </div>
          {/each}
        </div>
        <div style="margin-top:8px;padding-top:10px;border-top:1px solid #EEF1EF;display:flex;align-items:center;justify-content:space-between">
          <div style="display:flex;align-items:center;gap:6px;font-size:12.5px;color:#7B857F;padding-left:6px"><span style="width:6px;height:6px;border-radius:3px;background:#1db954"></span>Jours renseignés</div>
          <button class="press" onclick={v.goToday} style="height:44px;padding:0 20px;border-radius:22px;border:0;background:{v.todayBg};color:{v.todayFg};font-size:14.5px;font-weight:700">Aujourd'hui</button>
        </div>
      </div>
    {/if}
  </div>

  <div role="status" aria-label="Macros du jour" style="position:absolute;left:16px;right:16px;top:104px;z-index:6;height:52px;box-sizing:border-box;padding:0 8px 0 14px;border-radius:26px;background:rgba(255,255,255,.94);border:1px solid #E9EDEA;box-shadow:0 1px 2px rgba(15,21,18,.05),0 14px 30px -12px rgba(15,21,18,.28);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);display:flex;align-items:center;gap:10px;opacity:{v.fb.o};transform:translateY({v.fb.y}px);transition:opacity .22s ease,transform .26s cubic-bezier(.2,.8,.2,1);pointer-events:none">
      <div style="display:flex;flex-direction:column;line-height:1.1;flex:none">
        <span style="font-size:10px;font-weight:900;letter-spacing:.08em;color:#66716B">KCAL</span>
        <span style="font-size:14px;font-weight:900;color:{v.hero.text}">{v.hero.consumed}<span style="font-weight:700;color:#66716B">/2&nbsp;400</span></span>
      </div>
      <span style="width:1px;height:26px;background:#E9EDEA;flex:none"></span>
      {#each v.fbMacros as m}
        <div style="display:flex;align-items:center;gap:6px;flex:1;min-width:0">
          <svg width="28" height="28" viewBox="0 0 28 28" aria-hidden="true" style="flex:none"><circle cx="14" cy="14" r="10.500" fill="none" stroke="#eef0ec" stroke-width="4"></circle><circle cx="14" cy="14" r="10.500" fill="none" stroke={m.color} stroke-width="4" stroke-linecap="round" stroke-dasharray={m.fdash} transform="rotate(-90 14 14)"></circle></svg>
          <div style="display:flex;flex-direction:column;line-height:1.1;min-width:0">
            <span style="font-size:9.500px;font-weight:900;letter-spacing:.06em;color:#66716B">{m.short}</span>
            <span style="font-size:12.500px;font-weight:900;color:{m.text};white-space:nowrap">{m.got}<span style="font-weight:700;color:#66716B">/{m.goal}</span></span>
          </div>
        </div>
      {/each}
    </div>

  <div onscroll={v.onScroll} style="flex:1;min-height:0;overflow-y:auto;padding:14px 20px 170px">

    <div style="animation:{v.an.fade} .28s ease-out both;padding:16px 18px;border-radius:24px;border:1px solid {v.hero.border};background:{v.hero.bg};box-shadow:0 18px 40px -22px {v.hero.shadow}">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px">
        <div>
          <div style="font-size:15px;font-weight:700;color:#3A4540">{v.hero.prefix}</div>
          <div style="margin-top:2px;display:flex;align-items:baseline;gap:7px"><span aria-label={v.hero.value} class={v.hero.cls} style="--k:{v.hero.k};--h:{v.hero.h};--t:{v.hero.t};--n:{v.hero.n};animation:{v.an.cnt} .7s ease-out both;font-size:40px;font-weight:900;letter-spacing:-0.04em;line-height:1.05;font-variant-numeric:tabular-nums"></span><span style="font-size:17px;font-weight:700;color:#66716B">kcal</span></div>
        </div>
        <span style="width:42px;height:42px;border-radius:21px;background:#FFFFFF;color:{v.hero.accent};display:flex;align-items:center;justify-content:center;flex:none;box-shadow:0 6px 16px -8px rgba(15,21,18,.3)">
          {#if v.hero.shield}<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l7 3v5c0 5-3 8.5-7 10-4-1.5-7-5-7-10V6Z"></path><path d="M9 12l2 2 4-4"></path></svg>{/if}
          {#if v.hero.bell}<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 16v-5a6 6 0 0 1 12 0v5l1.5 2h-15Z"></path><path d="M10 21h4"></path></svg>{/if}
        </span>
      </div>
      {#if v.hero.pulse}
        <div style="margin-top:10px;display:flex;align-items:center;gap:8px;font-size:14px;font-weight:700;color:{v.hero.text}">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12h4l2-5 4 10 2-5h6"></path></svg>{v.hero.sub}
        </div>
      {/if}
      {#if v.hero.alert}
        <div style="margin-top:10px;display:flex;align-items:center;gap:8px;font-size:14px;font-weight:700;color:{v.hero.text}">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="flex:none"><path d="M12 4l9 16H3Z"></path><path d="M12 10v4M12 17v.5"></path></svg>{v.hero.sub}
        </div>
      {/if}
      <div style="position:relative;margin-top:14px;height:10px;border-radius:5px;background:#E8EDEA">
        <div style="width:{v.hero.fill};height:100%;border-radius:5px;background:{v.hero.accent};transform-origin:left;animation:{v.an.bar} .6s cubic-bezier(.2,.8,.2,1) both"></div>
        <div style="position:absolute;left:88.9%;top:-3px;width:3px;height:16px;border-radius:2px;background:#0F1512;opacity:.55"></div>
      </div>
      <div style="margin-top:12px;display:flex;align-items:baseline;justify-content:space-between;gap:8px;font-size:13px">
        <span style="font-weight:700;color:{v.hero.text}">{v.hero.consumed} kcal consommées</span>
        <span style="color:#66716B"><strong style="color:#0F1512">Objectif : 2&nbsp;400</strong> · Maint. : 2&nbsp;700</span>
      </div>
    </div>

    <div style="margin-top:10px;display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px">
      {#each v.macros as m}
        <div style="animation:{v.an.fade} .28s ease-out both;animation-delay:{m.delay}ms;padding:10px 6px 11px;border-radius:20px;border:1px solid #EEF1EF;background:#FFFFFF;box-shadow:0 1px 2px rgba(15,21,18,.04),0 12px 26px -16px rgba(15,21,18,.18);display:flex;flex-direction:column;align-items:center;gap:6px">
          <span style="font-size:12.500px;font-weight:700;color:#3A4540">{m.label}</span>
          <div style="position:relative;width:64px;height:64px">
            <svg width="64" height="64" viewBox="0 0 76 76" aria-hidden="true"><circle cx="38" cy="38" r="32" fill="none" stroke="#eef0ec" stroke-width="7"></circle><circle cx="38" cy="38" r="32" fill="none" stroke={m.color} stroke-width="7" stroke-linecap="round" stroke-dasharray={m.dash} transform="rotate(-90 38 38)" style="animation:{v.an.ring} .8s cubic-bezier(.2,.8,.2,1) both"></circle></svg>
            <span style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:900;color:{m.text}"><span aria-label={m.pct} class="c1" style="--n:{m.n};animation:{v.an.cnt} .7s ease-out both"></span>%</span>
          </div>
          <span style="font-size:12.500px;color:#66716B"><strong style="color:#0F1512">{m.got}</strong>/{m.goal}g</span>
        </div>
      {/each}
    </div>

    {#each v.meals as meal}
      <div>
        <div style="animation:{v.an.fade} .28s ease-out both;animation-delay:{meal.delay}ms;display:flex;align-items:center;justify-content:space-between;margin-top:14px">
          <div style="min-width:0">
            <div style="display:flex;align-items:baseline;gap:8px;white-space:nowrap"><span aria-hidden="true" style="align-self:center;width:28px;height:28px;border-radius:9px;background:#e8fef0;color:#1db954;display:flex;align-items:center;justify-content:center;flex:none">{#if meal.i0}<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 9.5h11v4.5a4 4 0 0 1-4 4H9a4 4 0 0 1-4-4V9.5Z"></path><path d="M16 11h1.2a2.3 2.3 0 0 1 0 4.600H16"></path><path d="M8.500 3.500v2.500M12.500 3.500v2.500"></path></svg>{/if}{#if meal.i1}<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 3v5.500a2.500 2.500 0 0 0 5 0V3M9.500 3v18"></path><path d="M17.500 21V3c-2.500 1.400-3.500 4.200-3.500 8.500h3.500"></path></svg>{/if}{#if meal.i2}<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 14.500A8 8 0 0 1 9.500 4a8 8 0 1 0 10.500 10.500Z"></path><path d="M17.500 4v3M16 5.500h3"></path></svg>{/if}{#if meal.i3}<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 8.500c-1.500-1.300-6-1.500-6 3.500 0 4 2.500 8 4.500 8 .8 0 1-.5 1.500-.5s.7.5 1.500.5c2 0 4.500-4 4.500-8 0-5-4.500-4.800-6-3.500Z"></path><path d="M12 8.500c0-2 .8-3.500 2.500-4.500"></path></svg>{/if}</span><h2 style="margin:0;font-size:17px;font-weight:900;letter-spacing:-0.02em;line-height:1.1">{meal.name}</h2><span style="font-size:12.5px;font-weight:700;color:#0d7c36">{meal.summary}</span></div>
                      </div>
          <div style="display:flex;gap:6px;flex:none">
            <button class="press" aria-label="Ajouter par photo" style="width:38px;height:38px;padding:0;border-radius:19px;border:0;background:#e8fef0;color:#1db954;display:flex;align-items:center;justify-content:center">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 8h3l1.5-2h7L17 8h3v11H4Z"></path><circle cx="12" cy="13" r="3.5"></circle></svg>
            </button>
            <button class="press" aria-label="Ajouter un aliment" style="width:38px;height:38px;padding:0;border-radius:19px;border:0;background:#e8fef0;color:#1db954;display:flex;align-items:center;justify-content:center">
              <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"></path></svg>
            </button>
          </div>
        </div>
        {#if meal.hasItems}
          <div style="animation:{v.an.fade} .28s ease-out both;animation-delay:{meal.delay2}ms;margin-top:6px;border-radius:18px;border:1px solid #EEF1EF;background:#FFFFFF;box-shadow:0 1px 2px rgba(15,21,18,.04),0 12px 26px -16px rgba(15,21,18,.18);overflow:hidden">
            {#each meal.items as it}
              <div style="display:flex;align-items:center;gap:11px;padding:5px 0 5px 8px;border-top:{it.border}">
                {#if it.hasImg}
                  <img src={it.img} alt="" style="width:36px;height:36px;border-radius:10px;object-fit:cover;flex:none;background:#F3F6F4">
                {/if}
                {#if it.noImg}
                  <div style="width:36px;height:36px;border-radius:10px;background:#e8fef0;color:#1db954;display:flex;align-items:center;justify-content:center;flex:none">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5.5 3v5.5a2.5 2.5 0 0 0 5 0V3"></path><path d="M8 3v6.5M8 11v10"></path><path d="M17 21V3c-2.5 1.2-3.5 4-3.5 8H17"></path></svg>
                  </div>
                {/if}
                <div style="flex:1;min-width:0">
                  <div style="font-size:14px;font-weight:700;line-height:1.2;letter-spacing:-0.005em;display:-webkit-box;-webkit-line-clamp:1;-webkit-box-orient:vertical;overflow:hidden">{it.name}</div>
                  <div style="margin-top:1px;font-size:12px;color:#66716B;white-space:nowrap;overflow:hidden;text-overflow:ellipsis"><span style="font-size:12px;font-weight:700;color:#0d7c36">{it.kcal} kcal</span> · {it.qty}</div>
                </div>
                <button class="press" aria-label="Marquer comme fait" onclick={it.toggle} style="width:42px;height:42px;padding:0;border:0;background:transparent;display:flex;align-items:center;justify-content:center;flex:none">
                  <span style="width:23px;height:23px;box-sizing:border-box;border-radius:13px;border:2px solid {it.ring};background:{it.fill};color:#FFFFFF;display:flex;align-items:center;justify-content:center;transition:background-color .18s ease,border-color .18s ease">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="opacity:{it.check};transform:scale({it.sc});transition:opacity .15s ease,transform .2s cubic-bezier(.3,1.6,.5,1)"><path d="M5 12.5l4.500 4.500L19 7.500"></path></svg>
                  </span>
                </button>
              </div>
            {/each}
          </div>
        {/if}
      </div>
    {/each}

    {#if v.tipOpen}
      <div style="animation:{v.an.fade} .28s ease-out both;animation-delay:240ms;margin-top:18px;padding:14px 16px;border-radius:20px;border:1.5px dashed rgba(29,185,84,.3);background:#f3fcf7;display:flex;align-items:flex-start;gap:12px">
        <div style="flex:1">
          <div style="font-size:11px;font-weight:900;letter-spacing:.12em;color:#0d7c36">ASTUCE DU JOUR</div>
          <div style="margin-top:6px;font-size:15px;line-height:1.45;color:#0F1512">Dépasser une macro ponctuellement n'est pas un échec. Regarde d'abord l'ensemble de ta journée et ta moyenne sur plusieurs jours.</div>
        </div>
        <button class="press" aria-label="Fermer l'astuce" onclick={v.closeTip} style="width:44px;height:44px;padding:0;border-radius:22px;border:0;background:transparent;color:#4A5550;display:flex;align-items:center;justify-content:center;flex:none">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"></path></svg>
        </button>
      </div>
    {/if}
  </div>

  <div style="position:absolute;left:0;right:0;bottom:0;height:150px;background:linear-gradient(to bottom,rgba(255,255,255,0),#FFFFFF 66%);pointer-events:none"></div>

  <a class="press" href="/search" aria-label="Ajouter un aliment" style="position:absolute;right:20px;bottom:118px;width:62px;height:62px;border-radius:31px;background:#1db954;color:#FFFFFF;display:flex;align-items:center;justify-content:center;box-shadow:0 18px 32px -10px rgba(23,163,73,.7)">
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"></path></svg>
  </a>

  <BottomNav variant="A" active="journal" />
</div>
