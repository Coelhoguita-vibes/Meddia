import { LocalNotifications } from '@capacitor/local-notifications';
import { Capacitor } from '@capacitor/core';
    (function () {
      'use strict';

      var STORAGE_KEY = 'meddia_app_state_v1';

      function getTodayDateString() {
        var now = new Date();
        var y = now.getFullYear();
        var m = String(now.getMonth() + 1).padStart(2, '0');
        var d = String(now.getDate()).padStart(2, '0');
        return y + '-' + m + '-' + d;
      }

      function getDefaultMedications() {
        var now = new Date();
        var nextHour = new Date(now.getTime() + 10 * 60000);
        var nearTimeStr = String(nextHour.getHours()).padStart(2, '0') + ':' + String(nextHour.getMinutes()).padStart(2, '0');

        return [
          {
            id: 'med_1',
            name: 'Losartana Potássica',
            dosage: '50mg',
            doseQty: 1,
            unit: 'comprimido(s)',
            frequency: 2,
            times: ['08:00', '20:00'],
            boxSize: 30,
            currentStock: 24,
            notes: 'Tomar com água, de preferência no mesmo horário',
            leadMinutes: 15
          },
          {
            id: 'med_2',
            name: 'Amoxicilina',
            dosage: '500mg',
            doseQty: 1,
            unit: 'cápsula(s)',
            frequency: 3,
            times: ['07:00', nearTimeStr, '23:00'],
            boxSize: 21,
            currentStock: 12,
            notes: 'Antibiótico de 8 em 8 horas — tomar com bastante água',
            leadMinutes: 15
          },
          {
            id: 'med_3',
            name: 'Vitamina D3 + Cálcio',
            dosage: '2.000 UI',
            doseQty: 2,
            unit: 'comprimido(s)',
            frequency: 1,
            times: ['12:30'],
            boxSize: 60,
            currentStock: 10,
            notes: 'Tomar junto com o almoço',
            leadMinutes: 15
          }
        ];
      }

      // Native Android reminders. Notifications are scheduled on-device and work offline.
      var nativeNotificationsReady = false;
      var MAX_PENDING_REMINDERS = 400;
      var REMINDER_DAYS_AHEAD = 30;

      function isNativeApp() {
        return Capacitor.isNativePlatform && Capacitor.isNativePlatform();
      }

      async function prepareNativeNotifications() {
        if (!isNativeApp()) return false;
        try {
          if (!nativeNotificationsReady) {
            await LocalNotifications.createChannel({
              id: 'meddia-reminders',
              name: 'Lembretes de medicamentos',
              description: 'Avisos nos horários cadastrados no MedDia',
              importance: 4,
              visibility: 1
            });
            nativeNotificationsReady = true;
          }
          var permission = await LocalNotifications.checkPermissions();
          return permission.display === 'granted';
        } catch (err) {
          console.warn('Não foi possível preparar as notificações nativas:', err);
          return false;
        }
      }

      function makeReminderId(dateKey, medId, timeStr) {
        var raw = dateKey + '__' + medId + '__' + timeStr;
        var hash = 2166136261;
        for (var i = 0; i < raw.length; i++) {
          hash ^= raw.charCodeAt(i);
          hash = Math.imul(hash, 16777619);
        }
        return (hash >>> 0) % 2147483647 || 1;
      }

      async function syncNativeReminders() {
        if (!isNativeApp()) return;
        try {
          if (!(await prepareNativeNotifications())) return;
          await LocalNotifications.cancelAll();
          var notifications = [];
          var now = new Date();
          for (var dayOffset = 0; dayOffset < REMINDER_DAYS_AHEAD; dayOffset++) {
            var day = new Date(now.getFullYear(), now.getMonth(), now.getDate() + dayOffset);
            var dateKey = day.getFullYear() + '-' + String(day.getMonth() + 1).padStart(2, '0') + '-' + String(day.getDate()).padStart(2, '0');
            state.medications.forEach(function (med) {
              var times = Array.isArray(med.times) ? med.times : ['08:00'];
              times.forEach(function (timeStr) {
                var doseKey = dateKey + '__' + med.id + '__' + timeStr;
                if (state.takenLogs[doseKey]) return;
                var parts = String(timeStr).split(':');
                var at = new Date(day.getFullYear(), day.getMonth(), day.getDate(), Number(parts[0]) || 0, Number(parts[1]) || 0, 0, 0);
                if (at.getTime() <= now.getTime()) return;
                if (notifications.length >= MAX_PENDING_REMINDERS) return;
                notifications.push({
                  title: 'Hora do remédio: ' + med.name,
                  body: 'Dose: ' + formatNumberPt(med.doseQty) + ' ' + med.unit + ' — horário ' + timeStr + '.',
                  id: makeReminderId(dateKey, med.id, timeStr),
                  schedule: { at: at, allowWhileIdle: true },
                  channelId: 'meddia-reminders',
                  extra: { medicationId: med.id, date: dateKey, time: timeStr }
                });
              });
            });
          }
          if (notifications.length) {
            await LocalNotifications.schedule({ notifications: notifications });
          }
        } catch (err) {
          console.warn('Falha ao atualizar lembretes do MedDia:', err);
        }
      }

      function refreshNativeRemindersSoon() {
        if (isNativeApp()) syncNativeReminders();
      }

      var state = {
        activeTab: 'today',
        todayFilter: 'all',
        soundEnabled: true,
        currentDateKey: getTodayDateString(),
        medications: [],
        takenLogs: {},
        expandedDoseKeys: {},
        notifiedKeys: {},
        bannerDismissedKey: null,
        modalConfirmCallback: null
      };

      function loadState() {
        var todayKey = getTodayDateString();
        try {
          var raw = localStorage.getItem(STORAGE_KEY);
          if (raw) {
            var parsed = JSON.parse(raw);
            if (parsed && Array.isArray(parsed.medications)) {
              state.medications = parsed.medications;
              state.takenLogs = parsed.takenLogs || {};
              state.soundEnabled = parsed.soundEnabled !== false;
            }
          }
        } catch (err) {
          // Ignore storage error in restricted iframe
        }

        if (!state.medications || state.medications.length === 0) {
          state.medications = getDefaultMedications();
          state.takenLogs = {};
          var sampleKey = todayKey + '__med_1__08:00';
          state.takenLogs[sampleKey] = {
            takenAt: '08:04',
            qtyDeducted: 1
          };
        }
        state.currentDateKey = todayKey;
      }

      function saveState() {
        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify({
            medications: state.medications,
            takenLogs: state.takenLogs,
            soundEnabled: state.soundEnabled
          }));
        } catch (err) {
          // Ignore storage error
        }
      }

      // Web Audio API Synthesized Chime for Reminders and Confirmations
      var audioCtx = null;
      function playSound(type) {
        if (!state.soundEnabled) return;
        try {
          var AudioContextClass = window.AudioContext || window.webkitAudioContext;
          if (!AudioContextClass) return;
          if (!audioCtx) {
            audioCtx = new AudioContextClass();
          }
          if (audioCtx.state === 'suspended') {
            audioCtx.resume();
          }

          var now = audioCtx.currentTime;
          var osc = audioCtx.createOscillator();
          var gain = audioCtx.createGain();
          osc.connect(gain);
          gain.connect(audioCtx.destination);

          if (type === 'success') {
            osc.type = 'sine';
            osc.frequency.setValueAtTime(523.25, now);
            osc.frequency.setValueAtTime(659.25, now + 0.09);
            gain.gain.setValueAtTime(0.12, now);
            gain.gain.exponentialRampToValueAtTime(0.001, now + 0.28);
            osc.start(now);
            osc.stop(now + 0.29);
          } else if (type === 'warning') {
            osc.type = 'triangle';
            osc.frequency.setValueAtTime(330, now);
            osc.frequency.setValueAtTime(260, now + 0.14);
            gain.gain.setValueAtTime(0.16, now);
            gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
            osc.start(now);
            osc.stop(now + 0.36);
          } else if (type === 'alarm') {
            osc.type = 'sine';
            osc.frequency.setValueAtTime(784, now);
            osc.frequency.setValueAtTime(987.77, now + 0.15);
            osc.frequency.setValueAtTime(784, now + 0.3);
            gain.gain.setValueAtTime(0.18, now);
            gain.gain.exponentialRampToValueAtTime(0.001, now + 0.55);
            osc.start(now);
            osc.stop(now + 0.56);
          }
        } catch (e) {
          // Ignore audio error if blocked
        }
      }

      var toastTimer = null;
      function showToast(msg) {
        var toastEl = document.getElementById('toastNotification');
        var msgEl = document.getElementById('toastMessageText');
        msgEl.textContent = msg;
        toastEl.classList.remove('hidden');
        if (toastTimer) clearTimeout(toastTimer);
        toastTimer = setTimeout(function () {
          toastEl.classList.add('hidden');
        }, 4200);
      }

      function openSafetyModal(options) {
        var overlay = document.getElementById('safetyModalOverlay');
        var titleEl = document.getElementById('safetyModalTitle');
        var subEl = document.getElementById('safetyModalSubtitle');
        var bodyEl = document.getElementById('safetyModalBody');
        var confirmBtn = document.getElementById('btnSafetyModalConfirm');
        var cancelBtn = document.getElementById('btnSafetyModalCancel');

        titleEl.textContent = options.title || 'Atenção!';
        subEl.textContent = options.subtitle || '';
        bodyEl.textContent = options.body || '';
        confirmBtn.textContent = options.confirmText || 'Confirmar';
        cancelBtn.textContent = options.cancelText || 'Cancelar';

        state.modalConfirmCallback = options.onConfirm || null;
        overlay.classList.remove('hidden');
      }

      function closeSafetyModal() {
        var overlay = document.getElementById('safetyModalOverlay');
        overlay.classList.add('hidden');
        state.modalConfirmCallback = null;
      }

      function formatNumberPt(val) {
        var n = Number(val);
        if (isNaN(n)) return '0';
        return Number.isInteger(n) ? String(n) : n.toFixed(1).replace('.', ',');
      }

      function parseTimeMinutes(hhmm) {
        if (!hhmm || typeof hhmm !== 'string') return 0;
        var parts = hhmm.split(':');
        var h = parseInt(parts[0], 10) || 0;
        var m = parseInt(parts[1], 10) || 0;
        return h * 60 + m;
      }

      function getCurrentHHMM() {
        var now = new Date();
        return String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');
      }

      function getStockStats(med) {
        var freq = Math.max(1, Number(med.frequency) || (med.times ? med.times.length : 1));
        var doseQty = Math.max(0.5, Number(med.doseQty) || 1);
        var dailyUsage = freq * doseQty;
        var currentStock = Math.max(0, Number(med.currentStock) || 0);

        var daysRemaining = dailyUsage > 0 ? Math.floor(currentStock / dailyUsage) : 0;

        var endDate = new Date();
        endDate.setDate(endDate.getDate() + daysRemaining);
        var endDateFormatted = endDate.toLocaleDateString('pt-BR', {
          day: '2-digit',
          month: '2-digit',
          year: 'numeric'
        });

        var statusLevel = 'ok';
        if (daysRemaining <= 3 || currentStock === 0) {
          statusLevel = 'critical';
        } else if (daysRemaining <= 7) {
          statusLevel = 'warning';
        }

        return {
          dailyUsage: dailyUsage,
          daysRemaining: daysRemaining,
          endDateFormatted: endDateFormatted,
          statusLevel: statusLevel
        };
      }

      function buildDoseKey(medId, timeStr) {
        return state.currentDateKey + '__' + medId + '__' + timeStr;
      }

      function getAllTodayDoses() {
        var list = [];
        var now = new Date();
        var currentMinutes = now.getHours() * 60 + now.getMinutes();

        state.medications.forEach(function (med) {
          var times = Array.isArray(med.times) ? med.times : ['08:00'];
          times.forEach(function (timeStr) {
            var key = buildDoseKey(med.id, timeStr);
            var logEntry = state.takenLogs[key] || null;
            var scheduledMinutes = parseTimeMinutes(timeStr);
            var diffMinutes = scheduledMinutes - currentMinutes;
            var lead = Number(med.leadMinutes);
            if (isNaN(lead)) lead = 15;

            var proximityState = 'scheduled';
            if (logEntry) {
              proximityState = 'taken';
            } else if (diffMinutes >= 0 && diffMinutes <= Math.max(lead, 15)) {
              proximityState = 'upcoming';
            } else if (diffMinutes < 0 && diffMinutes >= -90) {
              proximityState = 'due_now';
            } else if (diffMinutes < -90) {
              proximityState = 'late';
            }

            list.push({
              key: key,
              med: med,
              timeStr: timeStr,
              scheduledMinutes: scheduledMinutes,
              diffMinutes: diffMinutes,
              takenLog: logEntry,
              proximityState: proximityState
            });
          });
        });

        list.sort(function (a, b) {
          return a.scheduledMinutes - b.scheduledMinutes;
        });

        return list;
      }

      function handleDoseClick(medId, timeStr) {
        var med = state.medications.find(function (m) { return m.id === medId; });
        if (!med) return;

        var key = buildDoseKey(medId, timeStr);
        var existingLog = state.takenLogs[key];

        // If ALREADY TAKEN TODAY -> trigger anti-double-dose safety modal!
        if (existingLog) {
          playSound('warning');
          openSafetyModal({
            title: 'Você já tomou este remédio hoje!',
            subtitle: med.name + ' (' + (med.dosage || '') + ') — Horário ' + timeStr,
            body: 'Consta que você já marcou esta dose hoje às ' + existingLog.takenAt + '. Este bloqueio evita que você tome o medicamento 2 vezes sem querer. Deseja apenas manter como tomado ou desmarcar por erro de toque?',
            cancelText: 'Manter Como Tomado',
            confirmText: 'Desmarcar Registro',
            onConfirm: function () {
              var restoredQty = Number(existingLog.qtyDeducted) || Number(med.doseQty) || 1;
              med.currentStock = Math.max(0, Number(med.currentStock) + restoredQty);
              delete state.takenLogs[key];
              saveState();
              refreshNativeRemindersSoon();
              renderAll();
              showToast('Registro desmarcado e ' + formatNumberPt(restoredQty) + ' ' + med.unit + ' devolvido(s) ao estoque.');
            }
          });
          return;
        }

        // Mark as taken now and deduct from stock
        var deductQty = Number(med.doseQty) || 1;
        med.currentStock = Math.max(0, Number(med.currentStock) - deductQty);
        var takenTime = getCurrentHHMM();
        state.takenLogs[key] = {
          takenAt: takenTime,
          qtyDeducted: deductQty
        };

        playSound('success');
        saveState();
        refreshNativeRemindersSoon();
        renderAll();
        showToast('✓ ' + med.name + ' (' + timeStr + ') marcado como tomado às ' + takenTime + '! Estoque atualizado.');
      }

      function adjustStock(medId, delta) {
        var med = state.medications.find(function (m) { return m.id === medId; });
        if (!med) return;
        var nextVal = Math.max(0, Number(med.currentStock) + Number(delta));
        med.currentStock = nextVal;
        playSound('success');
        saveState();
        renderAll();
        var sign = delta > 0 ? '+' + formatNumberPt(delta) : formatNumberPt(delta);
        showToast('Estoque de ' + med.name + ' atualizado (' + sign + '). Total: ' + formatNumberPt(nextVal) + ' ' + med.unit + '.');
      }

      function renderSoundButton() {
        var iconWrap = document.getElementById('soundIconWrapper');
        var textEl = document.getElementById('soundStatusText');
        if (state.soundEnabled) {
          textEl.textContent = 'Som Ativo';
          iconWrap.innerHTML = '<svg class="w-4 h-4 text-teal-200" fill="none" stroke="currentColor" stroke-width="2.2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" /></svg>';
        } else {
          textEl.textContent = 'Silenciado';
          iconWrap.innerHTML = '<svg class="w-4 h-4 text-rose-200" fill="none" stroke="currentColor" stroke-width="2.2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" /><path stroke-linecap="round" stroke-linejoin="round" d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2" /></svg>';
        }
      }

      function renderClockAndAlerts() {
        var now = new Date();
        var clockEl = document.getElementById('liveClockBadge');
        var dateEl = document.getElementById('currentDateSubtitle');
        clockEl.textContent = getCurrentHHMM();
        var formattedDate = now.toLocaleDateString('pt-BR', {
          weekday: 'long',
          day: '2-digit',
          month: 'long'
        });
        dateEl.textContent = formattedDate.charAt(0).toUpperCase() + formattedDate.slice(1);

        var doses = getAllTodayDoses();
        var urgentDose = null;
        for (var i = 0; i < doses.length; i++) {
          var d = doses[i];
          if (!d.takenLog && (d.proximityState === 'upcoming' || d.proximityState === 'due_now')) {
            urgentDose = d;
            break;
          }
        }

        var bannerEl = document.getElementById('upcomingAlertBanner');
        var bannerTitle = document.getElementById('upcomingAlertTitle');
        var bannerMsg = document.getElementById('upcomingAlertMessage');

        if (urgentDose && state.bannerDismissedKey !== urgentDose.key) {
          bannerEl.classList.remove('hidden');
          if (urgentDose.diffMinutes > 0) {
            bannerTitle.textContent = 'Lembrete: Horário Próximo (em ' + urgentDose.diffMinutes + ' min)';
          } else if (urgentDose.diffMinutes === 0) {
            bannerTitle.textContent = 'Hora do Remédio Agora!';
          } else {
            bannerTitle.textContent = 'Horário Programado (' + urgentDose.timeStr + ') — Ainda não marcado';
          }
          bannerMsg.textContent = urgentDose.med.name + ' ' + (urgentDose.med.dosage || '') + ' — Tomar ' + formatNumberPt(urgentDose.med.doseQty) + ' ' + urgentDose.med.unit + ' às ' + urgentDose.timeStr + '.';

          if (!state.notifiedKeys[urgentDose.key]) {
            state.notifiedKeys[urgentDose.key] = true;
            playSound('alarm');
            triggerBrowserNotification(
              'Hora do Remédio: ' + urgentDose.med.name,
              'Horário: ' + urgentDose.timeStr + ' — Dose: ' + formatNumberPt(urgentDose.med.doseQty) + ' ' + urgentDose.med.unit
            );
          }
        } else {
          bannerEl.classList.add('hidden');
        }
      }

      function triggerBrowserNotification(title, bodyText) {
        try {
          if ('Notification' in window && Notification.permission === 'granted') {
            new Notification(title, { body: bodyText });
          }
        } catch (e) {
          // Ignore in sandboxed iframe
        }
      }

      function renderTodayTab() {
        var doses = getAllTodayDoses();
        var total = doses.length;
        var takenCount = doses.filter(function (d) { return Boolean(d.takenLog); }).length;
        var pendingCount = total - takenCount;
        var pct = total > 0 ? Math.round((takenCount / total) * 100) : 0;

        document.getElementById('todayProgressTitle').textContent = takenCount + ' de ' + total + ' doses tomadas hoje';
        document.getElementById('todayPercentBadge').textContent = pct + '%';
        document.getElementById('todayProgressBar').style.width = pct + '%';

        document.getElementById('countFilterAll').textContent = String(total);
        document.getElementById('countFilterPending').textContent = String(pendingCount);
        document.getElementById('countFilterTaken').textContent = String(takenCount);

        var badgePending = document.getElementById('badgePendingToday');
        if (pendingCount > 0) {
          badgePending.textContent = String(pendingCount);
          badgePending.classList.remove('hidden');
        } else {
          badgePending.classList.add('hidden');
        }

        var filterBtns = document.querySelectorAll('.today-filter-btn');
        filterBtns.forEach(function (btn) {
          var f = btn.getAttribute('data-filter');
          if (f === state.todayFilter) {
            btn.className = 'today-filter-btn px-3 py-1.5 rounded-xl text-xs font-bold transition bg-teal-700 text-white shadow-2xs';
          } else {
            btn.className = 'today-filter-btn px-3 py-1.5 rounded-xl text-xs font-bold transition bg-slate-100 text-slate-700 hover:bg-slate-200';
          }
        });

        var filteredDoses = doses.filter(function (d) {
          if (state.todayFilter === 'pending') return !d.takenLog;
          if (state.todayFilter === 'taken') return Boolean(d.takenLog);
          return true;
        });

        var container = document.getElementById('todayScheduleContainer');
        if (filteredDoses.length === 0) {
          container.innerHTML =
            '<div class="bg-white rounded-2xl p-6 text-center border border-slate-200/80">' +
              '<p class="text-sm font-bold text-slate-700">Nenhum horário encontrado neste filtro.</p>' +
              '<p class="text-xs text-slate-500 mt-1">Use os filtros acima ou cadastre novos medicamentos na Aba 3.</p>' +
            '</div>';
          return;
        }

        var html = '';
        filteredDoses.forEach(function (item) {
          var med = item.med;
          var isTaken = Boolean(item.takenLog);
          var isExpanded = Boolean(state.expandedDoseKeys[item.key]);
          var stats = getStockStats(med);

          var cardBorder = 'border-slate-200 bg-white';
          var statusBadgeHtml = '';
          if (isTaken) {
            cardBorder = 'border-emerald-300 bg-emerald-50/50';
            statusBadgeHtml =
              '<span class="inline-flex items-center gap-1 text-xs font-extrabold uppercase tracking-wide bg-emerald-600 text-white px-2.5 py-0.5 rounded-full">' +
                '✓ Já Tomei Hoje às ' + item.takenLog.takenAt +
              '</span>';
          } else if (item.proximityState === 'upcoming') {
            cardBorder = 'border-amber-400 bg-amber-50/40 ring-2 ring-amber-200';
            statusBadgeHtml =
              '<span class="inline-flex items-center gap-1 text-xs font-extrabold uppercase tracking-wide bg-amber-500 text-slate-950 px-2.5 py-0.5 rounded-full">' +
                '⏰ Próximo (em ' + item.diffMinutes + ' min)' +
              '</span>';
          } else if (item.proximityState === 'due_now') {
            cardBorder = 'border-amber-400 bg-amber-50/60';
            statusBadgeHtml =
              '<span class="inline-flex items-center gap-1 text-xs font-extrabold uppercase tracking-wide bg-amber-600 text-white px-2.5 py-0.5 rounded-full">' +
                '🔔 Horário de Tomar!' +
              '</span>';
          } else if (item.proximityState === 'late') {
            cardBorder = 'border-rose-300 bg-rose-50/30';
            statusBadgeHtml =
              '<span class="inline-flex items-center gap-1 text-xs font-bold uppercase tracking-wide bg-rose-100 text-rose-800 px-2.5 py-0.5 rounded-full border border-rose-200">' +
                'Pendente (' + item.timeStr + ')' +
              '</span>';
          } else {
            statusBadgeHtml =
              '<span class="inline-flex items-center gap-1 text-xs font-bold uppercase tracking-wide bg-slate-100 text-slate-600 px-2.5 py-0.5 rounded-full">' +
                'Programado' +
              '</span>';
          }

          var buttonHtml = '';
          if (isTaken) {
            buttonHtml =
              '<button type="button" data-action="toggle-dose" data-med-id="' + med.id + '" data-time="' + item.timeStr + '" class="w-full sm:w-auto px-4 py-3 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-sm font-extrabold shadow-2xs transition flex items-center justify-center gap-1.5">' +
                '<svg class="w-4 h-4 shrink-0" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" /></svg>' +
                '<span>JÁ TOMADO (' + item.takenLog.takenAt + ')</span>' +
              '</button>';
          } else {
            buttonHtml =
              '<button type="button" data-action="toggle-dose" data-med-id="' + med.id + '" data-time="' + item.timeStr + '" class="w-full sm:w-auto px-4 py-3 rounded-xl bg-teal-700 hover:bg-teal-800 active:scale-95 text-white text-sm font-extrabold shadow-sm transition flex items-center justify-center gap-1.5">' +
                '<svg class="w-4 h-4 shrink-0" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>' +
                '<span>Marcar que Tomei</span>' +
              '</button>';
          }

          var expandedSectionHtml = '';
          if (isExpanded) {
            expandedSectionHtml =
              '<div class="mt-3.5 pt-3.5 border-t border-slate-200/80 grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-sm bg-slate-50/90 p-3.5 rounded-xl">' +
                '<div class="space-y-1">' +
                  '<span class="text-xs font-bold uppercase tracking-wider text-slate-500 block">Instruções de Uso</span>' +
                  '<p class="font-semibold text-slate-900">' +
                    (med.notes ? escapeHtml(med.notes) : 'Sem instruções extras cadastradas.') +
                  '</p>' +
                '</div>' +
                '<div class="space-y-1">' +
                  '<span class="text-xs font-bold uppercase tracking-wider text-slate-500 block">Estoque em Reserva</span>' +
                  '<p class="font-semibold ' + (stats.statusLevel === 'critical' ? 'text-rose-700' : 'text-slate-900') + '">' +
                    'Restam <strong>' + formatNumberPt(med.currentStock) + ' ' + escapeHtml(med.unit) + '</strong> (dura mais <strong>' + stats.daysRemaining + ' dias</strong>)' +
                  '</p>' +
                  '<p class="text-xs text-slate-500">Horários do dia: ' + med.times.join(', ') + '</p>' +
                '</div>' +
              '</div>';
          }

          html +=
            '<div class="rounded-2xl p-4 shadow-2xs border transition ' + cardBorder + '">' +
              '<div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3">' +
                '<div data-action="expand-dose" data-dose-key="' + item.key + '" class="flex items-center gap-3.5 cursor-pointer select-none flex-1">' +
                  '<div class="px-3.5 py-2.5 rounded-xl ' + (isTaken ? 'bg-emerald-700 text-white' : 'bg-slate-900 text-white') + ' text-center shrink-0 min-w-[74px]">' +
                    '<span class="block text-base font-extrabold tracking-tight">' + item.timeStr + '</span>' +
                  '</div>' +
                  '<div class="space-y-1 flex-1">' +
                    '<div class="flex items-center flex-wrap gap-1.5">' +
                      statusBadgeHtml +
                    '</div>' +
                    '<h3 class="text-lg font-extrabold leading-snug ' + (isTaken ? 'text-emerald-950' : 'text-slate-900') + '">' +
                      escapeHtml(med.name) + (med.dosage ? ' <span class="text-base font-bold text-teal-700">' + escapeHtml(med.dosage) + '</span>' : '') +
                    '</h3>' +
                    '<div class="flex items-center flex-wrap gap-2 text-sm font-bold text-slate-700">' +
                      '<span>Tomar ' + formatNumberPt(med.doseQty) + ' ' + escapeHtml(med.unit) + '</span>' +
                      '<span class="text-xs font-semibold text-teal-700 bg-teal-50 px-2 py-0.5 rounded-lg border border-teal-200/80">' +
                        (isExpanded ? 'Ocultar detalhes ▴' : 'Ver estoque e instruções ▾') +
                      '</span>' +
                    '</div>' +
                  '</div>' +
                '</div>' +
                '<div class="shrink-0">' +
                  buttonHtml +
                '</div>' +
              '</div>' +
              expandedSectionHtml +
            '</div>';
        });

        container.innerHTML = html;
      }

      function renderStockTab() {
        var totalMeds = state.medications.length;
        var lowCount = 0;
        var safeCount = 0;

        state.medications.forEach(function (med) {
          var st = getStockStats(med);
          if (st.daysRemaining <= 7) {
            lowCount++;
          } else {
            safeCount++;
          }
        });

        document.getElementById('stockMetricTotalMeds').textContent = String(totalMeds);
        document.getElementById('stockMetricSafeMeds').textContent = String(safeCount);
        document.getElementById('stockMetricLowMeds').textContent = String(lowCount);

        var badgeLow = document.getElementById('badgeLowStock');
        if (lowCount > 0) {
          badgeLow.textContent = String(lowCount);
          badgeLow.classList.remove('hidden');
        } else {
          badgeLow.classList.add('hidden');
        }

        var container = document.getElementById('stockCardsContainer');
        if (totalMeds === 0) {
          container.innerHTML =
            '<div class="bg-white rounded-2xl p-6 text-center border border-slate-200">' +
              '<p class="text-sm font-bold text-slate-700">Nenhum medicamento em estoque.</p>' +
              '<p class="text-xs text-slate-500 mt-1">Cadastre seus medicamentos na Aba 3 para acompanhar quantos dias de estoque ainda restam.</p>' +
            '</div>';
          return;
        }

        var html = '';
        state.medications.forEach(function (med) {
          var st = getStockStats(med);
          var badgeColor = 'bg-emerald-100 text-emerald-800 border-emerald-200';
          var barColor = 'bg-emerald-500';
          var statusText = 'Estoque Confortável';

          if (st.statusLevel === 'critical') {
            badgeColor = 'bg-rose-100 text-rose-800 border-rose-300';
            barColor = 'bg-rose-600';
            statusText = 'Estoque Crítico — Repor Urgente!';
          } else if (st.statusLevel === 'warning') {
            badgeColor = 'bg-amber-100 text-amber-900 border-amber-300';
            barColor = 'bg-amber-500';
            statusText = 'Atenção: Acaba em menos de 1 semana';
          }

          var autonomyPct = Math.min(100, Math.round((st.daysRemaining / 30) * 100));

          html +=
            '<div class="bg-white rounded-2xl p-4 shadow-sm border border-slate-200/90 space-y-3">' +
              '<div class="flex items-start justify-between gap-2">' +
                '<div>' +
                  '<span class="inline-block text-[11px] font-extrabold uppercase px-2.5 py-0.5 rounded-full border ' + badgeColor + '">' +
                    statusText +
                  '</span>' +
                  '<h3 class="text-lg font-extrabold text-slate-900 mt-1.5">' +
                    escapeHtml(med.name) + (med.dosage ? ' <span class="text-base font-bold text-teal-700">' + escapeHtml(med.dosage) + '</span>' : '') +
                  '</h3>' +
                '</div>' +
                '<div class="text-right bg-slate-900 text-white px-3.5 py-2 rounded-xl shrink-0">' +
                  '<span class="block text-lg font-extrabold leading-none">' + st.daysRemaining + ' dias</span>' +
                  '<span class="block text-[10px] font-medium text-teal-200 mt-0.5">de duração</span>' +
                '</div>' +
              '</div>' +

              '<div class="grid grid-cols-2 gap-3 bg-slate-50 p-3.5 rounded-xl border border-slate-200/70 text-xs">' +
                '<div>' +
                  '<span class="text-slate-500 block font-medium">Quantidade em Reserva</span>' +
                  '<strong class="text-slate-900 text-base font-extrabold">' + formatNumberPt(med.currentStock) + ' ' + escapeHtml(med.unit) + '</strong>' +
                '</div>' +
                '<div>' +
                  '<span class="text-slate-500 block font-medium">Consumo Diário</span>' +
                  '<strong class="text-slate-900 text-base font-extrabold">' + formatNumberPt(st.dailyUsage) + ' por dia (' + med.frequency + 'x)</strong>' +
                '</div>' +
              '</div>' +

              '<div>' +
                '<div class="flex items-center justify-between text-xs mb-1">' +
                  '<span class="font-semibold text-slate-600">Previsão de término: <strong class="text-slate-900">' + st.endDateFormatted + '</strong></span>' +
                  '<span class="font-bold text-slate-700">Autonomia: ' + st.daysRemaining + ' dias</span>' +
                '</div>' +
                '<div class="w-full h-2.5 bg-slate-100 rounded-full overflow-hidden border border-slate-200/60">' +
                  '<div class="h-full ' + barColor + ' transition-all duration-300" style="width: ' + autonomyPct + '%"></div>' +
                '</div>' +
              '</div>' +

              '<div class="flex items-center justify-between gap-2 pt-2 border-t border-slate-100 flex-wrap">' +
                '<div class="flex items-center gap-1.5">' +
                  '<button type="button" data-action="stock-adjust" data-med-id="' + med.id + '" data-delta="-1" class="px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-extrabold transition">' +
                    '-1' +
                  '</button>' +
                  '<button type="button" data-action="stock-adjust" data-med-id="' + med.id + '" data-delta="1" class="px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-extrabold transition">' +
                    '+1 avulso' +
                  '</button>' +
                '</div>' +
                '<button type="button" data-action="stock-add-box" data-med-id="' + med.id + '" class="px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 active:scale-95 text-white text-xs font-extrabold shadow-2xs transition flex items-center gap-1.5">' +
                  '<svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2.3" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>' +
                  '<span>Repor / Configurar na Aba 3</span>' +
                '</button>' +
              '</div>' +
            '</div>';
        });

        container.innerHTML = html;
      }

      function renderTimeSlotInputs(timesArray) {
        var container = document.getElementById('timeSlotsInputsContainer');
        var html = '';
        timesArray.forEach(function (val, idx) {
          html +=
            '<div>' +
              '<label class="block text-[11px] font-bold text-slate-600 mb-1">' + (idx + 1) + 'º Horário</label>' +
              '<input type="time" data-time-slot-index="' + idx + '" value="' + val + '" required class="med-time-slot-input w-full rounded-xl border border-slate-300 px-2.5 py-2 text-sm font-extrabold text-slate-900 bg-white focus:outline-none focus:ring-2 focus:ring-teal-600" />' +
            '</div>';
        });
        container.innerHTML = html;
      }

      function getDefaultTimesForFrequency(freq) {
        var f = Number(freq) || 1;
        if (f === 1) return ['08:00'];
        if (f === 2) return ['08:00', '20:00'];
        if (f === 3) return ['07:00', '15:00', '23:00'];
        if (f === 4) return ['06:00', '12:00', '18:00', '00:00'];
        return ['08:00'];
      }

      function updateFormDurationPreview() {
        var doseQty = Math.max(0.5, Number(document.getElementById('medInputDoseQty').value) || 1);
        var freq = Math.max(1, Number(document.getElementById('medInputFrequency').value) || 1);
        var stock = Math.max(0, Number(document.getElementById('medInputCurrentStock').value) || 0);
        var daily = doseQty * freq;
        var days = daily > 0 ? Math.floor(stock / daily) : 0;
        var previewEl = document.getElementById('formCalculatedDurationPreview');
        previewEl.textContent = 'Consumo: ' + formatNumberPt(daily) + '/dia • Dura ' + days + ' dias';
      }

      function renderConfiguredMedsList() {
        var container = document.getElementById('configuredMedsListContainer');
        if (state.medications.length === 0) {
          container.innerHTML = '<p class="text-xs text-slate-500 py-3 text-center">Nenhum medicamento cadastrado ainda.</p>';
          return;
        }

        var html = '';
        state.medications.forEach(function (med) {
          var st = getStockStats(med);
          html +=
            '<div class="p-3.5 rounded-2xl bg-slate-50 border border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">' +
              '<div>' +
                '<h4 class="text-sm font-extrabold text-slate-900">' +
                  escapeHtml(med.name) + (med.dosage ? ' <span class="text-teal-700">' + escapeHtml(med.dosage) + '</span>' : '') +
                '</h4>' +
                '<p class="text-xs text-slate-600 mt-0.5">' +
                  formatNumberPt(med.doseQty) + ' ' + escapeHtml(med.unit) + ' • ' + med.frequency + 'x ao dia (' + med.times.join(', ') + ')' +
                '</p>' +
                '<p class="text-[11px] font-semibold text-indigo-700 mt-0.5">' +
                  'Reserva atual: ' + formatNumberPt(med.currentStock) + ' ' + escapeHtml(med.unit) + ' (dura ' + st.daysRemaining + ' dias)' +
                '</p>' +
              '</div>' +
              '<div class="flex items-center gap-2 shrink-0">' +
                '<button type="button" data-action="edit-med" data-med-id="' + med.id + '" class="px-3 py-1.5 rounded-xl bg-white hover:bg-teal-50 text-teal-800 border border-slate-300 text-xs font-bold transition">' +
                  'Editar' +
                '</button>' +
                '<button type="button" data-action="delete-med" data-med-id="' + med.id + '" class="px-3 py-1.5 rounded-xl bg-white hover:bg-rose-50 text-rose-600 border border-slate-300 text-xs font-bold transition">' +
                  'Excluir' +
                '</button>' +
              '</div>' +
            '</div>';
        });

        container.innerHTML = html;
      }

      function populateFormForEdit(medId, focusStock) {
        var med = state.medications.find(function (m) { return m.id === medId; });
        if (!med) return;

        document.getElementById('medInputId').value = med.id;
        document.getElementById('medInputName').value = med.name;
        document.getElementById('medInputDosage').value = med.dosage || '';
        document.getElementById('medInputDoseQty').value = med.doseQty;
        document.getElementById('medInputUnit').value = med.unit;
        document.getElementById('medInputFrequency').value = String(med.frequency);
        document.getElementById('medInputBoxSize').value = med.boxSize || 30;
        document.getElementById('medInputCurrentStock').value = med.currentStock;
        document.getElementById('medInputNotes').value = med.notes || '';
        document.getElementById('medInputLeadMinutes').value = String(med.leadMinutes !== undefined ? med.leadMinutes : 15);

        renderTimeSlotInputs(med.times);
        updateFormDurationPreview();

        document.getElementById('formModeBadge').textContent = '3. Editando / Repondo Medicamento';
        document.getElementById('formHeaderTitle').textContent = 'Configurar ou Repor: ' + med.name;
        document.getElementById('btnSubmitMedFormText').textContent = 'Salvar Alterações';
        document.getElementById('btnCancelEdit').classList.remove('hidden');

        var formCard = document.getElementById('medConfigFormCard');
        if (formCard) {
          formCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
        if (focusStock) {
          setTimeout(function () {
            var stockInp = document.getElementById('medInputCurrentStock');
            if (stockInp) {
              stockInp.focus();
              stockInp.select();
            }
          }, 350);
        }
      }

      function resetConfigForm() {
        document.getElementById('medInputId').value = '';
        document.getElementById('medInputName').value = '';
        document.getElementById('medInputDosage').value = '';
        document.getElementById('medInputDoseQty').value = '1';
        document.getElementById('medInputUnit').value = 'comprimido(s)';
        document.getElementById('medInputFrequency').value = '2';
        document.getElementById('medInputBoxSize').value = '30';
        document.getElementById('medInputCurrentStock').value = '30';
        document.getElementById('medInputNotes').value = '';
        document.getElementById('medInputLeadMinutes').value = '15';
        document.getElementById('formValidationError').classList.add('hidden');

        renderTimeSlotInputs(getDefaultTimesForFrequency(2));
        updateFormDurationPreview();

        document.getElementById('formModeBadge').textContent = '3. Cadastrar ou Configurar';
        document.getElementById('formHeaderTitle').textContent = 'Cadastrar ou Configurar Medicamento';
        document.getElementById('btnSubmitMedFormText').textContent = 'Salvar Medicamento';
        document.getElementById('btnCancelEdit').classList.add('hidden');
      }

      function switchTab(tabName) {
        state.activeTab = tabName;
        var panels = {
          today: document.getElementById('tabPanelToday'),
          stock: document.getElementById('tabPanelStock'),
          config: document.getElementById('tabPanelConfig')
        };

        Object.keys(panels).forEach(function (k) {
          if (k === tabName) {
            panels[k].classList.remove('hidden');
          } else {
            panels[k].classList.add('hidden');
          }
        });

        var navBtns = document.querySelectorAll('.nav-tab-btn');
        navBtns.forEach(function (btn) {
          var t = btn.getAttribute('data-tab');
          if (t === tabName) {
            btn.className = 'nav-tab-btn flex flex-col items-center justify-center py-2 px-1 rounded-xl transition text-teal-800 bg-teal-50 font-extrabold shadow-2xs';
          } else {
            btn.className = 'nav-tab-btn flex flex-col items-center justify-center py-2 px-1 rounded-xl transition text-slate-500 hover:text-slate-800 font-semibold';
          }
        });

        renderAll();
      }

      function escapeHtml(str) {
        if (!str) return '';
        return String(str)
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;')
          .replace(/'/g, '&#039;');
      }

      function renderAll() {
        renderSoundButton();
        renderClockAndAlerts();
        renderTodayTab();
        renderStockTab();
        renderConfiguredMedsList();
      }

      function initEvents() {
        // Bottom Nav Tabs
        document.querySelectorAll('.nav-tab-btn').forEach(function (btn) {
          btn.addEventListener('click', function () {
            var tab = btn.getAttribute('data-tab');
            switchTab(tab);
          });
        });

        // Today Filters
        document.querySelectorAll('.today-filter-btn').forEach(function (btn) {
          btn.addEventListener('click', function () {
            state.todayFilter = btn.getAttribute('data-filter') || 'all';
            renderTodayTab();
          });
        });

        // Delegate clicks in Today Schedule Container (Mark Dose or Expand Details)
        document.getElementById('todayScheduleContainer').addEventListener('click', function (e) {
          var toggleDoseBtn = e.target.closest('[data-action="toggle-dose"]');
          if (toggleDoseBtn) {
            var medId = toggleDoseBtn.getAttribute('data-med-id');
            var timeStr = toggleDoseBtn.getAttribute('data-time');
            handleDoseClick(medId, timeStr);
            return;
          }

          var expandArea = e.target.closest('[data-action="expand-dose"]');
          if (expandArea) {
            var doseKey = expandArea.getAttribute('data-dose-key');
            if (doseKey) {
              state.expandedDoseKeys[doseKey] = !state.expandedDoseKeys[doseKey];
              renderTodayTab();
            }
          }
        });

        // Delegate clicks in Stock Container
        document.getElementById('stockCardsContainer').addEventListener('click', function (e) {
          var adjustBtn = e.target.closest('[data-action="stock-adjust"]');
          if (adjustBtn) {
            var medId = adjustBtn.getAttribute('data-med-id');
            var delta = Number(adjustBtn.getAttribute('data-delta'));
            adjustStock(medId, delta);
            return;
          }
          var reporConfigBtn = e.target.closest('[data-action="stock-add-box"]');
          if (reporConfigBtn) {
            var id = reporConfigBtn.getAttribute('data-med-id');
            switchTab('config');
            populateFormForEdit(id, true);
            showToast('Ajuste a quantidade comprada/reserva no formulário abaixo.');
          }
        });

        // Quick scroll to new med form on Tab 3
        document.getElementById('btnQuickScrollNewMed').addEventListener('click', function () {
          resetConfigForm();
          var formCard = document.getElementById('medConfigFormCard');
          if (formCard) {
            formCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }
          setTimeout(function () {
            var nameInp = document.getElementById('medInputName');
            if (nameInp) nameInp.focus();
          }, 350);
        });

        // Delegate clicks in Configured Meds List
        document.getElementById('configuredMedsListContainer').addEventListener('click', function (e) {
          var editBtn = e.target.closest('[data-action="edit-med"]');
          if (editBtn) {
            populateFormForEdit(editBtn.getAttribute('data-med-id'), false);
            return;
          }
          var delBtn = e.target.closest('[data-action="delete-med"]');
          if (delBtn) {
            var medId = delBtn.getAttribute('data-med-id');
            var med = state.medications.find(function (m) { return m.id === medId; });
            if (!med) return;
            openSafetyModal({
              title: 'Excluir ' + med.name + '?',
              subtitle: 'Esta ação remove o medicamento das abas Hoje e Estoque',
              body: 'Tem certeza de que deseja remover "' + med.name + '" da sua lista de medicamentos cadastrados?',
              cancelText: 'Cancelar',
              confirmText: 'Sim, Excluir',
              onConfirm: function () {
                state.medications = state.medications.filter(function (m) { return m.id !== medId; });
                saveState();
                refreshNativeRemindersSoon();
                renderAll();
                showToast('Medicamento removido.');
              }
            });
          }
        });

        // Frequency dropdown updates time slots
        document.getElementById('medInputFrequency').addEventListener('change', function (e) {
          var freq = Number(e.target.value) || 1;
          renderTimeSlotInputs(getDefaultTimesForFrequency(freq));
          updateFormDurationPreview();
        });

        ['medInputDoseQty', 'medInputBoxSize', 'medInputCurrentStock'].forEach(function (id) {
          document.getElementById(id).addEventListener('input', updateFormDurationPreview);
        });

        document.getElementById('btnCancelEdit').addEventListener('click', function () {
          resetConfigForm();
        });

        // Submit Form (Add / Update Medication)
        document.getElementById('medConfigForm').addEventListener('submit', function (e) {
          e.preventDefault();
          var errBox = document.getElementById('formValidationError');
          var nameVal = document.getElementById('medInputName').value.trim();
          if (!nameVal) {
            errBox.textContent = 'Por favor, informe o nome do medicamento.';
            errBox.classList.remove('hidden');
            return;
          }

          var timeInputs = document.querySelectorAll('.med-time-slot-input');
          var timesList = [];
          timeInputs.forEach(function (inp) {
            if (inp.value) timesList.push(inp.value);
          });
          if (timesList.length === 0) {
            timesList = ['08:00'];
          }

          var editId = document.getElementById('medInputId').value;
          var currentStockVal = Math.max(0, Number(document.getElementById('medInputCurrentStock').value) || 0);
          var medData = {
            id: editId || ('med_' + Date.now()),
            name: nameVal,
            dosage: document.getElementById('medInputDosage').value.trim(),
            doseQty: Math.max(0.5, Number(document.getElementById('medInputDoseQty').value) || 1),
            unit: document.getElementById('medInputUnit').value,
            frequency: timesList.length,
            times: timesList,
            boxSize: Math.max(1, currentStockVal || 30),
            currentStock: currentStockVal,
            notes: document.getElementById('medInputNotes').value.trim(),
            leadMinutes: Number(document.getElementById('medInputLeadMinutes').value) || 15
          };

          if (editId) {
            var idx = state.medications.findIndex(function (m) { return m.id === editId; });
            if (idx !== -1) {
              state.medications[idx] = medData;
            }
            showToast('Medicamento "' + medData.name + '" atualizado!');
          } else {
            state.medications.push(medData);
            showToast('Medicamento "' + medData.name + '" cadastrado com sucesso!');
          }

          playSound('success');
          saveState();
          refreshNativeRemindersSoon();
          resetConfigForm();
          renderAll();
          switchTab('today');
        });

        // Toggle Sound
        document.getElementById('btnToggleSound').addEventListener('click', function () {
          state.soundEnabled = !state.soundEnabled;
          if (state.soundEnabled) {
            playSound('success');
            showToast('Alerta sonoro ativado.');
          } else {
            showToast('Alerta sonoro silenciado.');
          }
          saveState();
          renderSoundButton();
        });

        // Test Notification Button
        document.getElementById('btnTestAlert').addEventListener('click', function () {
          var doses = getAllTodayDoses();
          var nextPending = doses.find(function (d) { return !d.takenLog; }) || doses[0];
          state.bannerDismissedKey = null;
          playSound('alarm');
          if (isNativeApp()) {
            (async function () {
              try {
                var permission = await LocalNotifications.checkPermissions();
                if (permission.display !== 'granted') permission = await LocalNotifications.requestPermissions();
                if (permission.display === 'granted') {
                  await LocalNotifications.schedule({ notifications: [{
                    title: 'Teste de notificação MedDia',
                    body: 'As notificações do Android estão funcionando.',
                    id: 2147483000,
                    schedule: { at: new Date(Date.now() + 5000) },
                    channelId: 'meddia-reminders'
                  }] });
                  showToast('Notificação de teste agendada para daqui a 5 segundos.');
                }
              } catch (err) { showToast('Não foi possível agendar o teste.'); }
            })();
          }

          var bannerEl = document.getElementById('upcomingAlertBanner');
          var bannerTitle = document.getElementById('upcomingAlertTitle');
          var bannerMsg = document.getElementById('upcomingAlertMessage');
          bannerEl.classList.remove('hidden');

          if (nextPending) {
            bannerTitle.textContent = '🔔 Simulação de Aviso de Horário Próximo';
            bannerMsg.textContent = 'Está quase na hora de tomar ' + nextPending.med.name + ' (' + formatNumberPt(nextPending.med.doseQty) + ' ' + nextPending.med.unit + ') programado para ' + nextPending.timeStr + '!';
            triggerBrowserNotification(
              'Lembrete MedDia: ' + nextPending.med.name,
              'Horário: ' + nextPending.timeStr + ' — Toque na 1ª aba para marcar quando tomar.'
            );
          } else {
            bannerTitle.textContent = '🔔 Simulação de Aviso de Horário';
            bannerMsg.textContent = 'Todos os remédios foram cadastrados! Quando faltar 15 min para um horário, você verá e ouvirá este alerta.';
          }
          showToast('Aviso de horário disparado! Veja o alerta no topo.');
        });

        document.getElementById('btnDismissBanner').addEventListener('click', function () {
          var doses = getAllTodayDoses();
          var urgent = doses.find(function (d) { return !d.takenLog && (d.proximityState === 'upcoming' || d.proximityState === 'due_now'); });
          if (urgent) {
            state.bannerDismissedKey = urgent.key;
          }
          document.getElementById('upcomingAlertBanner').classList.add('hidden');
        });

        // Reset Today Marks
        document.getElementById('btnResetTodayMarks').addEventListener('click', function () {
          openSafetyModal({
            title: 'Reiniciar marcações de hoje?',
            subtitle: 'Todos os horários de hoje voltarão para "Faltam Tomar"',
            body: 'Deseja limpar as marcações de medicamentos tomados hoje e devolver as doses correspondentes ao estoque?',
            cancelText: 'Cancelar',
            confirmText: 'Reiniciar Hoje',
            onConfirm: function () {
              Object.keys(state.takenLogs).forEach(function (k) {
                if (k.indexOf(state.currentDateKey + '__') === 0) {
                  var parts = k.split('__');
                  var mId = parts[1];
                  var log = state.takenLogs[k];
                  var med = state.medications.find(function (m) { return m.id === mId; });
                  if (med && log && log.qtyDeducted) {
                    med.currentStock = Math.max(0, Number(med.currentStock) + Number(log.qtyDeducted));
                  }
                  delete state.takenLogs[k];
                }
              });
              saveState();
              refreshNativeRemindersSoon();
              renderAll();
              showToast('Marcações de hoje reiniciadas.');
            }
          });
        });

        // Restore Demo Data
        document.getElementById('btnRestoreDemoData').addEventListener('click', function () {
          state.medications = getDefaultMedications();
          state.takenLogs = {};
          var sampleKey = state.currentDateKey + '__med_1__08:00';
          state.takenLogs[sampleKey] = { takenAt: '08:04', qtyDeducted: 1 };
          saveState();
          refreshNativeRemindersSoon();
          resetConfigForm();
          renderAll();
          showToast('Medicamentos de exemplo restaurados!');
        });

        // Native Android notification permission and reminder scheduling
        document.getElementById('btnRequestBrowserNotif').addEventListener('click', async function () {
          var statusEl = document.getElementById('browserNotifStatusText');
          if (!isNativeApp()) {
            statusEl.textContent = 'As notificações nativas funcionam na versão APK instalada no Android.';
            showToast('Instale a versão APK para ativar os lembretes do Android.');
            return;
          }
          try {
            var permission = await LocalNotifications.checkPermissions();
            if (permission.display !== 'granted') {
              permission = await LocalNotifications.requestPermissions();
            }
            if (permission.display === 'granted') {
              await syncNativeReminders();
              statusEl.textContent = '✓ Notificações do Android ativadas. Os horários cadastrados foram agendados no aparelho.';
              showToast('Lembretes do Android ativados!');
            } else {
              statusEl.textContent = 'Permissão não concedida. Ative as notificações do MedDia nas configurações do Android.';
              showToast('Permissão de notificações não concedida.');
            }
          } catch (err) {
            statusEl.textContent = 'Não foi possível ativar as notificações. Verifique as permissões do Android.';
            showToast('Erro ao ativar notificações do Android.');
          }
        });

        // Safety Modal Buttons
        document.getElementById('btnSafetyModalCancel').addEventListener('click', function () {
          closeSafetyModal();
        });
        document.getElementById('btnSafetyModalConfirm').addEventListener('click', function () {
          var fn = state.modalConfirmCallback;
          closeSafetyModal();
          if (typeof fn === 'function') {
            fn();
          }
        });

        // Close Toast
        document.getElementById('btnCloseToast').addEventListener('click', function () {
          document.getElementById('toastNotification').classList.add('hidden');
        });
      }

      // Boot App
      loadState();
      resetConfigForm();
      initEvents();
      renderAll();
      if (isNativeApp()) {
        prepareNativeNotifications().then(function (granted) { if (granted) syncNativeReminders(); });
      }

      // Check schedule and clock every 20 seconds
      setInterval(function () {
        renderClockAndAlerts();
        renderTodayTab();
      }, 20000);
      // Register Service Worker for offline PWA & TWA APK support
      if ('serviceWorker' in navigator) {
        window.addEventListener('load', function () {
          navigator.serviceWorker.register('./sw.js').catch(function () {});
        });
      }
    })();
