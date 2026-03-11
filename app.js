(function () {
    // Persistent keys and static configuration.
    const STORAGE_KEY = "tasks";
    const THEME_KEY = "focusboard-theme";
    const VIEW_STATE_KEY = "focusboard-view-state";
    const COMPOSER_DRAFT_KEY = "focusboard-composer-draft";
    const TASK_NOTIFICATION_STATE_KEY = "focusboard-task-notification-state";
    const NOTIFICATION_PROMPT_STATE_KEY = "focusboard-notification-prompt-state";
    const IOS_DATE_PLACEHOLDER = "MM/DD/YYYY";
    const IOS_TIME_PLACEHOLDER = "HH:MM";
    const DATE_REQUIRED_FOR_TIME_MESSAGE = "Please choose a date before adding a time.";
    const DUE_SOON_MINUTES = 30;
    const NOTIFICATION_PROMPT_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;
    const STATUS_FILTERS = ["all", "active", "completed"];
    const PRIORITY_LEVELS = ["High", "Medium", "Low"];
    const SORT_MODES = ["newest", "oldest", "priority-desc", "priority-asc", "due-soon", "due-late"];
    const COMPLETION_TITLES = [
        "Task complete",
        "Nice work",
        "Momentum kept"
    ];
    const COMPLETION_MESSAGES = [
        "You wrapped this one up cleanly.",
        "Another win on the board.",
        "This task is officially done."
    ];
    const DUE_SOON_TITLES = [
        "Due soon",
        "Task deadline approaching",
        "Time to wrap this up"
    ];
    const OVERDUE_TITLES = [
        "You can still recover it.",
        "Get back in motion.",
        "Take control and regain momentum."
    ];
    const OVERDUE_MESSAGES = [
        "This task slipped past its due time. Pick one small move and get it moving again.",
        "The deadline passed, but the task is still recoverable. Start with the easiest next action.",
        "You are not behind forever. A small restart is enough to get this task back in motion."
    ];
    const PRIORITY_RANK = {
        High: 3,
        Medium: 2,
        Low: 1
    };

    // Task model stored in memory and serialized to localStorage.
    function Task(description, priority, dueDate, dueTime, createdAt, id) {
        this.id = id || generateTaskId();
        this.description = description;
        this.completed = false;
        this.priority = normalizePriority(priority);
        this.dueDate = normalizeDueDate(dueDate);
        this.dueTime = this.dueDate ? normalizeDueTime(dueTime) : "";
        this.createdAt = Number(createdAt) || Date.now();
    }

    // Toggle task completion state.
    Task.prototype.toggleComplete = function () {
        this.completed = !this.completed;
    };

    // DOM references.
    const taskForm = document.querySelector("#new-task-form");
    const taskInput = document.querySelector("#new-task-input");
    const taskDueDateInput = document.querySelector("#new-task-due-date");
    const taskDueDateResetButton = document.querySelector("#new-task-due-date-reset");
    const taskDueTimeInput = document.querySelector("#new-task-due-time");
    const taskDueTimeResetButton = document.querySelector("#new-task-due-time-reset");
    const taskDueTimeField = taskDueTimeInput ? taskDueTimeInput.closest(".time-field") : null;
    const tasksList = document.querySelector("#tasks-list");
    const emptyState = document.querySelector("#empty-state");
    const totalCount = document.querySelector("#count-total");
    const activeCount = document.querySelector("#count-active");
    const doneCount = document.querySelector("#count-done");
    const filterButtons = Array.from(document.querySelectorAll(".btn-filter"));
    const priorityFilterSelect = document.querySelector("#priority-filter");
    const sortModeSelect = document.querySelector("#sort-mode");
    const themeToggle = document.querySelector("#theme-toggle");
    const notificationModal = document.querySelector("#notification-modal");
    const notificationModalTitle = document.querySelector("#notification-modal-title");
    const notificationModalMessage = document.querySelector("#notification-modal-message");
    const notificationModalConfirmButton = document.querySelector("#notification-modal-confirm");
    const notificationModalDeclineButton = document.querySelector("#notification-modal-decline");
    const notificationModalDismissButton = document.querySelector("#notification-modal-dismiss");
    const composerPriorityInputs = Array.from(document.querySelectorAll("input[name='priority']"));
    const toastRegion = document.querySelector("#toast-region");
    const celebrationLayer = document.querySelector("#celebration-layer");

    // UI state for filtering and sorting.
    let activeFilter = "all";
    let activePriorityFilter = "all";
    let sortMode = "newest";
    const useIOSDateFallback = shouldUseIOSDateFallback();
    document.documentElement.classList.toggle("apple-device", useIOSDateFallback);
    let taskNotificationState = loadTaskNotificationState();
    let notificationPromptState = loadNotificationPromptState();
    let lastTimedRefreshKey = getCurrentLocalMinuteKey();
    let taskMetaLayoutFrame = 0;

    // In-memory state loaded once at startup.
    const tasks = loadTasks();

    // Normalize priority values from UI/storage.
    function normalizePriority(priority) {
        return PRIORITY_LEVELS.includes(priority) ? priority : "High";
    }

    // Keep status filter values inside the supported set.
    function normalizeActiveFilter(filter) {
        return STATUS_FILTERS.includes(filter) ? filter : "all";
    }

    // Keep toolbar priority filter values inside the supported set.
    function normalizePriorityFilter(priorityFilter) {
        return priorityFilter === "all" || PRIORITY_LEVELS.includes(priorityFilter) ? priorityFilter : "all";
    }

    // Keep sort mode values inside the supported set.
    function normalizeSortMode(mode) {
        return SORT_MODES.includes(mode) ? mode : "newest";
    }

    // Trim and collapse repeated whitespace.
    function normalizeDescription(value) {
        return value.replace(/\s+/g, " ").trim();
    }

    // Generate stable IDs so tasks can be highlighted and notified exactly once.
    function generateTaskId() {
        if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
            return crypto.randomUUID();
        }

        return `task-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
    }

    // Small helper for rotating celebratory and encouraging copy.
    function pickRandom(list) {
        if (!Array.isArray(list) || list.length === 0) {
            return "";
        }

        return list[Math.floor(Math.random() * list.length)];
    }

    // Safe storage access keeps the app usable when storage is unavailable.
    function getStorageItem(key) {
        try {
            return localStorage.getItem(key);
        } catch (error) {
            return null;
        }
    }

    // Safe storage writes avoid blocking the UI on storage quota/privacy errors.
    function setStorageItem(key, value) {
        try {
            localStorage.setItem(key, value);
        } catch (error) {}
    }

    // Safe storage removals let the app clear stale state without hard failures.
    function removeStorageItem(key) {
        try {
            localStorage.removeItem(key);
        } catch (error) {}
    }

    // Read JSON blobs from localStorage and ignore malformed payloads.
    function getStoredJSON(key) {
        const storedValue = getStorageItem(key);
        if (!storedValue) {
            return null;
        }

        try {
            return JSON.parse(storedValue);
        } catch (error) {
            return null;
        }
    }

    // Restore the due-soon/overdue alerts already sent for each task due moment.
    function loadTaskNotificationState() {
        const storedState = getStoredJSON(TASK_NOTIFICATION_STATE_KEY);
        return storedState && typeof storedState === "object" ? storedState : {};
    }

    // Persist alert tracking so the same due moment is only announced once per task.
    function saveTaskNotificationState() {
        setStorageItem(TASK_NOTIFICATION_STATE_KEY, JSON.stringify(taskNotificationState));
    }

    // Restore how often the alert opt-in modal has been shown and whether the user responded.
    function loadNotificationPromptState() {
        const storedState = getStoredJSON(NOTIFICATION_PROMPT_STATE_KEY) || {};
        return {
            status: storedState.status === "accepted" || storedState.status === "declined" ? storedState.status : "pending",
            lastShownAt: Number(storedState.lastShownAt) || 0
        };
    }

    // Persist the alert opt-in modal state across launches.
    function saveNotificationPromptState() {
        setStorageItem(NOTIFICATION_PROMPT_STATE_KEY, JSON.stringify(notificationPromptState));
    }

    // Drop tasks that no longer exist from the stored notification map.
    function pruneTaskNotificationState() {
        const validIds = new Set(tasks.map(task => task.id));
        const nextState = {};
        Object.entries(taskNotificationState).forEach(([taskId, notificationEntry]) => {
            if (validIds.has(taskId) && notificationEntry && typeof notificationEntry === "object") {
                nextState[taskId] = {
                    soon: typeof notificationEntry.soon === "string" ? notificationEntry.soon : "",
                    overdue: typeof notificationEntry.overdue === "string" ? notificationEntry.overdue : ""
                };
            }
        });
        taskNotificationState = nextState;
        saveTaskNotificationState();
    }

    // Build a lightweight toast with optional action and timed dismissal.
    function showToast(options) {
        if (!toastRegion) {
            return;
        }

        Array.from(toastRegion.children).forEach(existingToast => {
            if (typeof existingToast.dismissToast === "function") {
                existingToast.dismissToast(true);
            } else {
                existingToast.remove();
            }
        });

        const toast = document.createElement("article");
        toast.className = `toast toast--${options.variant || "info"} is-entering`;
        toast.setAttribute("role", "status");

        const title = document.createElement("h3");
        title.className = "toast-title";
        title.textContent = options.title || "";

        const message = document.createElement("p");
        message.className = "toast-message";
        message.textContent = options.message || "";

        const actions = document.createElement("div");
        actions.className = "toast-actions";

        if (typeof options.onAction === "function" && options.actionLabel) {
            const actionButton = document.createElement("button");
            actionButton.type = "button";
            actionButton.className = "btn btn-secondary toast-action";
            actionButton.textContent = options.actionLabel;
            actionButton.addEventListener("click", function () {
                options.onAction();
                dismissToast();
            });
            actions.appendChild(actionButton);
        }

        const dismissButton = document.createElement("button");
        dismissButton.type = "button";
        dismissButton.className = "toast-dismiss";
        dismissButton.setAttribute("aria-label", "Dismiss notification");
        dismissButton.textContent = "Dismiss";
        dismissButton.addEventListener("click", dismissToast);
        actions.appendChild(dismissButton);

        toast.appendChild(title);
        toast.appendChild(message);
        toast.appendChild(actions);
        toastRegion.prepend(toast);

        requestAnimationFrame(function () {
            toast.classList.remove("is-entering");
        });

        const dismissTimer = window.setTimeout(dismissToast, options.duration || 5200);
        toast.dismissToast = dismissToast;

        function dismissToast(immediate = false) {
            if (!toast.isConnected) {
                return;
            }

            window.clearTimeout(dismissTimer);

            if (immediate) {
                toast.remove();
                return;
            }

            toast.classList.add("is-leaving");
            window.setTimeout(function () {
                if (toast.isConnected) {
                    toast.remove();
                }
            }, 220);
        }
    }

    // App alerts are only active after the user opts in from the modal.
    function areTaskAlertsEnabled() {
        return notificationPromptState.status === "accepted";
    }

    // Switch the alert opt-in modal between prompt and result states.
    function setNotificationModalState(mode) {
        if (!notificationModalTitle || !notificationModalMessage || !notificationModalConfirmButton || !notificationModalDeclineButton || !notificationModalDismissButton) {
            return;
        }

        if (mode === "enabled") {
            notificationModalTitle.textContent = "Alerts are on";
            notificationModalMessage.textContent = `You will see reminders in Focus Board ${DUE_SOON_MINUTES} minutes before a timed task is due and again when it becomes overdue while this app stays open.`;
            notificationModalConfirmButton.hidden = true;
            notificationModalDeclineButton.hidden = true;
            notificationModalDismissButton.hidden = false;
            return;
        }

        if (mode === "off") {
            notificationModalTitle.textContent = "Alerts are still off";
            notificationModalMessage.textContent = "Focus Board will keep alerts off while this app stays open.";
            notificationModalConfirmButton.hidden = true;
            notificationModalDeclineButton.hidden = true;
            notificationModalDismissButton.hidden = false;
            return;
        }

        notificationModalTitle.textContent = "Turn on alerts?";
        notificationModalMessage.textContent = `See reminders in Focus Board ${DUE_SOON_MINUTES} minutes before a timed task is due and again when it becomes overdue while this app stays open.`;
        notificationModalConfirmButton.hidden = false;
        notificationModalDeclineButton.hidden = false;
        notificationModalDismissButton.hidden = true;
    }

    // Open the alert opt-in modal after a qualifying task-add action.
    function openNotificationModal() {
        if (!notificationModal) {
            return false;
        }

        setNotificationModalState("prompt");
        notificationModal.hidden = false;
        document.body.classList.add("modal-open");
        notificationPromptState.lastShownAt = Date.now();
        saveNotificationPromptState();
        notificationModalConfirmButton.focus();
        return true;
    }

    // Close the alert opt-in modal.
    function closeNotificationModal() {
        if (!notificationModal) {
            return;
        }

        notificationModal.hidden = true;
        document.body.classList.remove("modal-open");
    }

    // Prompt only once per week after a successful add until the user explicitly accepts or declines.
    function shouldShowNotificationModal() {
        if (!notificationModal) {
            return false;
        }

        if (notificationPromptState.status !== "pending") {
            return false;
        }

        return !notificationPromptState.lastShownAt || (Date.now() - notificationPromptState.lastShownAt) >= NOTIFICATION_PROMPT_INTERVAL_MS;
    }

    // Persist the user's choice so the weekly prompt stops after accept or decline.
    function resolveNotificationPrompt(status) {
        notificationPromptState.status = status;
        notificationPromptState.lastShownAt = Date.now();
        saveNotificationPromptState();
    }

    // Create a denser confetti burst for task completions.
    function launchConfetti() {
        if (!celebrationLayer) {
            return;
        }

        const colors = ["#00a391", "#ffd58c", "#9ed8ff", "#ff7d5f", "#1c2430"];

        for (let index = 0; index < 56; index += 1) {
            const piece = document.createElement("span");
            piece.className = "confetti-piece";
            piece.style.left = `${2 + Math.random() * 96}%`;
            piece.style.setProperty("--confetti-drift", `${-150 + Math.random() * 300}px`);
            piece.style.setProperty("--confetti-rotate", `${300 + Math.random() * 520}deg`);
            piece.style.setProperty("--confetti-duration", `${2200 + Math.random() * 1400}ms`);
            piece.style.setProperty("--confetti-delay", `${Math.random() * 300}ms`);
            piece.style.setProperty("--confetti-color", colors[index % colors.length]);
            celebrationLayer.appendChild(piece);

            window.setTimeout(function () {
                if (piece.isConnected) {
                    piece.remove();
                }
            }, 4500);
        }
    }

    // Bring a task back into focus for recovery prompts.
    function focusTask(taskId) {
        activeFilter = "active";
        activePriorityFilter = "all";
        sortMode = "due-soon";
        priorityFilterSelect.value = activePriorityFilter;
        sortModeSelect.value = sortMode;
        updateFilterButtons();
        saveViewState();
        renderTasks();

        const taskItem = tasksList.querySelector(`[data-task-id="${taskId}"]`);
        if (!taskItem) {
            return;
        }

        taskItem.classList.add("is-spotlight");
        taskItem.scrollIntoView({
            behavior: "smooth",
            block: "center"
        });

        window.setTimeout(function () {
            taskItem.classList.remove("is-spotlight");
        }, 1800);
    }

    // Congratulate the user and celebrate when a task is completed.
    function celebrateTaskCompletion(task) {
        launchConfetti();
        showToast({
            variant: "success",
            title: pickRandom(COMPLETION_TITLES),
            message: pickRandom(COMPLETION_MESSAGES),
            duration: 5600
        });
    }

    // Warn when a timed task is entering the due-soon window.
    function alertDueSoonTask(task) {
        if (!areTaskAlertsEnabled() || document.hidden) {
            return false;
        }

        showToast({
            title: pickRandom(DUE_SOON_TITLES),
            message: `${task.description} is due ${formatDate(task.dueDate, task.dueTime)}.`,
            actionLabel: "Focus task",
            onAction: function () {
                focusTask(task.id);
            },
            duration: 6800
        });
        return true;
    }

    // Encourage recovery when a task slips overdue.
    function encourageOverdueTask(task) {
        if (!areTaskAlertsEnabled() || document.hidden) {
            return false;
        }

        showToast({
            variant: "warning",
            title: pickRandom(OVERDUE_TITLES),
            message: pickRandom(OVERDUE_MESSAGES),
            actionLabel: "Focus task",
            onAction: function () {
                focusTask(task.id);
            },
            duration: 7600
        });
        return true;
    }

    // Keep only ISO date values (YYYY-MM-DD).
    function normalizeDueDate(value) {
        if (typeof value !== "string") {
            return "";
        }

        const trimmedValue = value.trim();
        if (!trimmedValue) {
            return "";
        }

        let year;
        let month;
        let day;

        const isoMatch = trimmedValue.match(/^(\d{4})-(\d{2})-(\d{2})$/);
        if (isoMatch) {
            year = isoMatch[1];
            month = isoMatch[2];
            day = isoMatch[3];
        } else {
            const slashMatch = trimmedValue.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
            if (!slashMatch) {
                return "";
            }

            year = slashMatch[3];
            month = slashMatch[1].padStart(2, "0");
            day = slashMatch[2].padStart(2, "0");
        }

        const yearNumber = Number(year);
        const monthNumber = Number(month);
        const dayNumber = Number(day);
        const parsedDate = new Date(yearNumber, monthNumber - 1, dayNumber);

        if (
            Number.isNaN(parsedDate.getTime()) ||
            parsedDate.getFullYear() !== yearNumber ||
            parsedDate.getMonth() !== monthNumber - 1 ||
            parsedDate.getDate() !== dayNumber
        ) {
            return "";
        }

        return `${year}-${month}-${day}`;
    }

    // Keep only HH:MM values in 24-hour time.
    function normalizeDueTime(value) {
        if (typeof value !== "string") {
            return "";
        }

        const trimmedValue = value.trim();
        if (!trimmedValue) {
            return "";
        }

        const timeMatch = trimmedValue.match(/^(\d{2}):(\d{2})(?::\d{2})?$/);
        if (!timeMatch) {
            return "";
        }

        const hour = Number(timeMatch[1]);
        const minute = Number(timeMatch[2]);

        if (hour > 23 || minute > 59) {
            return "";
        }

        return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
    }

    // Basic input safety and non-empty validation.
    function isValidDescription(value) {
        return value.length > 0 && !/[<>]/.test(value);
    }

    // Convert Date object to local ISO date (YYYY-MM-DD).
    function toLocalISODate(date) {
        if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
            return "";
        }

        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, "0");
        const day = String(date.getDate()).padStart(2, "0");
        return `${year}-${month}-${day}`;
    }

    // Convert Date object to local HH:MM.
    function toLocalISOTime(date) {
        if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
            return "";
        }

        const hours = String(date.getHours()).padStart(2, "0");
        const minutes = String(date.getMinutes()).padStart(2, "0");
        return `${hours}:${minutes}`;
    }

    // Read a reliable ISO date from an <input type="date"> across browser variations.
    function getISOFromDateInputElement(input) {
        if (!input) {
            return "";
        }

        const normalizedFromValue = normalizeDueDate(input.value);
        if (normalizedFromValue) {
            return normalizedFromValue;
        }

        return toLocalISODate(input.valueAsDate);
    }

    // Apply a dynamic minimum date so past dates cannot be selected.
    function applyMinDateConstraint(input) {
        if (!input) {
            return;
        }

        input.min = getTodayISO();
    }

    // Enable the time field only when a due date exists.
    function syncTimeInputAvailability(dateInput, timeInput, preserveCurrentValue = false) {
        if (!timeInput) {
            return;
        }

        const normalizedDate = getDateInputISOValue(dateInput);
        timeInput.disabled = !normalizedDate;
        timeInput.dataset.minimumTime = getMinimumTimeForDate(normalizedDate);
        timeInput.min = timeInput.dataset.minimumTime;

        if (!normalizedDate) {
            timeInput.dataset.isoTime = "";
            timeInput.value = "";
        } else if (!preserveCurrentValue && isPastTimeForDate(normalizedDate, getTimeInputValue(timeInput))) {
            timeInput.dataset.isoTime = "";
            timeInput.value = "";
        }

        syncTimeInputPresentation(timeInput);
    }

    // Convert ISO date to MM/DD/YYYY for consistent display across devices.
    function formatIsoDate(isoDate) {
        const normalizedDate = normalizeDueDate(isoDate);
        if (!normalizedDate) {
            return "";
        }

        const [year, month, day] = normalizedDate.split("-");
        return `${month}/${day}/${year}`;
    }

    // Convert HH:MM to a compact 12-hour time label.
    function formatDueTime(dueTime) {
        const normalizedTime = normalizeDueTime(dueTime);
        if (!normalizedTime) {
            return "";
        }

        const [hoursText, minutes] = normalizedTime.split(":");
        const hours = Number(hoursText);
        const meridiem = hours >= 12 ? "PM" : "AM";
        const twelveHour = hours % 12 || 12;
        return `${twelveHour}:${minutes} ${meridiem}`;
    }

    // Treat date-only tasks as due at the end of the selected day.
    function getDueMomentKey(dueDate, dueTime) {
        const normalizedDate = normalizeDueDate(dueDate);
        if (!normalizedDate) {
            return "";
        }

        return `${normalizedDate}T${normalizeDueTime(dueTime) || "23:59"}`;
    }

    // Parse a task due moment into a local Date for time-window comparisons.
    function getDueMomentDate(dueDate, dueTime) {
        const normalizedDate = normalizeDueDate(dueDate);
        const normalizedTime = normalizeDueTime(dueTime) || "23:59";

        if (!normalizedDate) {
            return null;
        }

        const [year, month, day] = normalizedDate.split("-").map(Number);
        const [hours, minutes] = normalizedTime.split(":").map(Number);
        const dueMomentDate = new Date(year, month - 1, day, hours, minutes, 0, 0);

        return Number.isNaN(dueMomentDate.getTime()) ? null : dueMomentDate;
    }

    // Current local YYYY-MM-DDTHH:MM value for overdue checks.
    function getCurrentLocalMinuteKey() {
        const now = new Date();
        return `${toLocalISODate(now)}T${toLocalISOTime(now)}`;
    }

    // Current local time rounded down to the active minute.
    function getCurrentLocalMinuteDate() {
        const now = new Date();
        now.setSeconds(0, 0);
        return now;
    }

    // Only today's tasks need a moving minimum time.
    function getMinimumTimeForDate(isoDate) {
        return normalizeDueDate(isoDate) === getTodayISO() ? toLocalISOTime(new Date()) : "";
    }

    // Past times are invalid only when the selected due date is today.
    function isPastTimeForDate(isoDate, dueTime) {
        const normalizedDate = normalizeDueDate(isoDate);
        const normalizedTime = normalizeDueTime(dueTime);

        if (!normalizedDate || !normalizedTime || normalizedDate !== getTodayISO()) {
            return false;
        }

        return `${normalizedDate}T${normalizedTime}` < getCurrentLocalMinuteKey();
    }

    // Read the currently selected composer priority radio.
    function getSelectedComposerPriority() {
        const selectedInput = composerPriorityInputs.find(input => input.checked);
        return normalizePriority(selectedInput ? selectedInput.value : "High");
    }

    // Restore the composer priority radio selection from storage.
    function setSelectedComposerPriority(priority) {
        const normalizedPriority = normalizePriority(priority);
        composerPriorityInputs.forEach(input => {
            input.checked = input.value === normalizedPriority;
        });
    }

    // Detect iOS/macOS touch Safari where empty date inputs can appear blank.
    function shouldUseIOSDateFallback() {
        const ua = navigator.userAgent || "";
        const isIOSDevice = /iPad|iPhone|iPod/.test(ua);
        const isTouchMac = navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1;
        return isIOSDevice || isTouchMac;
    }

    // Read normalized ISO value from a date input in both native and iOS-fallback modes.
    function getDateInputISOValue(input) {
        if (!input) {
            return "";
        }

        if (!useIOSDateFallback) {
            return getISOFromDateInputElement(input);
        }

        return normalizeDueDate(input.dataset.isoDate) || getISOFromDateInputElement(input);
    }

    // Read normalized time values in both native and iOS-fallback modes.
    function getTimeInputValue(input) {
        if (!input) {
            return "";
        }

        if (!useIOSDateFallback) {
            return normalizeDueTime(input.value);
        }

        return normalizeDueTime(input.dataset.isoTime) || normalizeDueTime(input.value);
    }

    // Clear the selected time so the task falls back to date-only behavior.
    function clearTimeInputValue(input) {
        if (!input) {
            return;
        }

        input.dataset.isoTime = "";
        input.value = "";
        syncTimeInputPresentation(input);
    }

    // Clear the selected date so the task falls back to an unscheduled state.
    function clearDateInputValue(input) {
        if (!input) {
            return;
        }

        input.dataset.isoDate = "";
        input.value = "";

        if (useIOSDateFallback) {
            syncDateInputPresentation(input, IOS_DATE_PLACEHOLDER);
        }
    }

    // Explain why time cannot be entered until a due date exists.
    function promptForDateBeforeTime() {
        alert(DATE_REQUIRED_FOR_TIME_MESSAGE);
    }

    // Keep disabled time wrappers visibly interactive for the date-required prompt.
    function syncTimeFieldState(field, input) {
        if (!field || !input) {
            return;
        }

        field.classList.toggle("is-disabled", input.disabled);
    }

    // Route clicks on disabled time wrappers to a date-required prompt.
    function attachTimeFieldPrompt(field, input) {
        if (!field || !input || field.dataset.timePromptAttached === "true") {
            return;
        }

        field.dataset.timePromptAttached = "true";
        field.addEventListener("click", function (event) {
            if (!input.disabled || event.target.closest(".time-reset")) {
                return;
            }

            promptForDateBeforeTime();
        });
    }

    // Keep the clear-time control visible only when a real time is present.
    function syncTimeResetButton(button, input) {
        if (!button || !input) {
            return;
        }

        const canClear = !input.disabled && Boolean(getTimeInputValue(input));
        button.hidden = !canClear;
        button.disabled = !canClear;
    }

    // Keep the clear-date control visible only when a real date is present.
    function syncDateResetButton(button, input) {
        if (!button || !input) {
            return;
        }

        const canClear = Boolean(getDateInputISOValue(input));
        button.hidden = !canClear;
        button.disabled = !canClear;
    }

    // Keep the composer time input, min-time rule, and clear button in sync.
    function syncComposerTimeInputState(preserveCurrentValue = false) {
        syncDateResetButton(taskDueDateResetButton, taskDueDateInput);
        syncTimeInputAvailability(taskDueDateInput, taskDueTimeInput, preserveCurrentValue);
        syncTimeFieldState(taskDueTimeField, taskDueTimeInput);
        syncTimeResetButton(taskDueTimeResetButton, taskDueTimeInput);
    }

    // Force text-mode rendering on iOS so empty and filled states share a consistent format.
    function syncDateInputPresentation(input, placeholderText) {
        if (!useIOSDateFallback || !input) {
            return;
        }

        const isoDate = getDateInputISOValue(input);
        input.dataset.isoDate = isoDate;
        input.type = "text";
        input.value = isoDate ? formatIsoDate(isoDate) : placeholderText;
        input.placeholder = "";
        input.classList.toggle("date-empty-fallback", !isoDate);
        input.setAttribute("inputmode", "none");
    }

    // Force text-mode rendering on iOS so empty time fields still show a visible cue.
    function syncTimeInputPresentation(input, placeholderText = IOS_TIME_PLACEHOLDER) {
        if (!useIOSDateFallback || !input) {
            return;
        }

        const normalizedTime = getTimeInputValue(input);
        input.dataset.isoTime = normalizedTime;
        input.type = "text";
        input.value = normalizedTime ? formatDueTime(normalizedTime) : placeholderText;
        input.placeholder = "";
        input.classList.toggle("time-empty-fallback", !normalizedTime);
        input.setAttribute("inputmode", "none");
    }

    // Switch to native date mode momentarily to open platform picker.
    function openNativeDatePicker(input) {
        if (!useIOSDateFallback || !input) {
            return;
        }

        const isoDate = getDateInputISOValue(input);
        input.type = "date";
        applyMinDateConstraint(input);
        input.value = isoDate;
        input.placeholder = "";
        input.classList.remove("date-empty-fallback");
        input.removeAttribute("inputmode");

        if (typeof input.showPicker === "function") {
            input.showPicker();
        }
    }

    // Switch to native time mode momentarily to open the platform picker.
    function openNativeTimePicker(input) {
        if (!useIOSDateFallback || !input || input.disabled) {
            return;
        }

        const normalizedTime = getTimeInputValue(input);
        input.type = "time";
        input.min = normalizeDueTime(input.dataset.minimumTime);
        input.value = normalizedTime;
        input.placeholder = "";
        input.classList.remove("time-empty-fallback");
        input.removeAttribute("inputmode");

        if (typeof input.showPicker === "function") {
            input.showPicker();
        }
    }

    // Attach iOS fallback behavior for a date input once.
    function applyDateInputFallback(input, placeholderText = IOS_DATE_PLACEHOLDER) {
        if (!useIOSDateFallback || !input) {
            return;
        }

        if (input.dataset.iosDateFallbackAttached === "true") {
            syncDateInputPresentation(input, placeholderText);
            return;
        }

        input.dataset.iosDateFallbackAttached = "true";
        input.dataset.isoDate = normalizeDueDate(input.value);
        applyMinDateConstraint(input);
        syncDateInputPresentation(input, placeholderText);

        input.addEventListener("focus", function () {
            openNativeDatePicker(input);
        });

        input.addEventListener("blur", function () {
            if (input.type === "date") {
                const normalizedDate = getISOFromDateInputElement(input);
                if (normalizedDate) {
                    input.dataset.isoDate = normalizedDate;
                }
            }
            syncDateInputPresentation(input, placeholderText);
        });

        input.addEventListener("change", function () {
            // Change is a committed picker action, so allow updates and explicit clears.
            const previousIsoDate = normalizeDueDate(input.dataset.isoDate);

            if (input.value === "") {
                input.dataset.isoDate = "";
            } else {
                const normalizedDate = getISOFromDateInputElement(input);
                if (isPastDate(normalizedDate)) {
                    alert("Past dates are not allowed. Please choose today or a future date.");
                    input.dataset.isoDate = !isPastDate(previousIsoDate) ? previousIsoDate : "";
                } else if (normalizedDate) {
                    input.dataset.isoDate = normalizedDate;
                }
            }
            syncDateInputPresentation(input, placeholderText);
        });

        // Some iOS versions update the field on "input" before "change".
        input.addEventListener("input", function () {
            const normalizedDate = getISOFromDateInputElement(input);
            if (!normalizedDate || isPastDate(normalizedDate)) {
                return;
            }

            input.dataset.isoDate = normalizedDate;
            syncDateInputPresentation(input, placeholderText);
        });

        input.addEventListener("click", function () {
            if (input.type !== "date") {
                openNativeDatePicker(input);
            }
        });
    }

    // Attach iOS fallback behavior for a time input once.
    function applyTimeInputFallback(input, placeholderText = IOS_TIME_PLACEHOLDER) {
        if (!useIOSDateFallback || !input) {
            return;
        }

        if (input.dataset.iosTimeFallbackAttached === "true") {
            syncTimeInputPresentation(input, placeholderText);
            return;
        }

        input.dataset.iosTimeFallbackAttached = "true";
        input.dataset.isoTime = getTimeInputValue(input);
        input.dataset.minimumTime = normalizeDueTime(input.min);
        syncTimeInputPresentation(input, placeholderText);

        input.addEventListener("focus", function () {
            openNativeTimePicker(input);
        });

        input.addEventListener("blur", function () {
            if (input.type === "time") {
                const normalizedTime = normalizeDueTime(input.value);
                if (normalizedTime) {
                    input.dataset.isoTime = normalizedTime;
                }
            }
            syncTimeInputPresentation(input, placeholderText);
        });

        input.addEventListener("change", function () {
            const previousIsoTime = normalizeDueTime(input.dataset.isoTime);
            const minimumTime = normalizeDueTime(input.dataset.minimumTime);

            if (input.value === "") {
                input.dataset.isoTime = "";
            } else {
                const normalizedTime = normalizeDueTime(input.value);
                if (minimumTime && normalizedTime && normalizedTime < minimumTime) {
                    alert("Past times are not allowed for today. Please choose the current time or a future time.");
                    input.dataset.isoTime = previousIsoTime && previousIsoTime >= minimumTime ? previousIsoTime : "";
                } else if (normalizedTime) {
                    input.dataset.isoTime = normalizedTime;
                }
            }
            syncTimeInputPresentation(input, placeholderText);
        });

        input.addEventListener("input", function () {
            const normalizedTime = normalizeDueTime(input.value);
            const minimumTime = normalizeDueTime(input.dataset.minimumTime);

            if (!normalizedTime || (minimumTime && normalizedTime < minimumTime)) {
                return;
            }

            input.dataset.isoTime = normalizedTime;
        });

        input.addEventListener("click", function () {
            if (input.type !== "time" && !input.disabled) {
                openNativeTimePicker(input);
            }
        });
    }

    // Build local YYYY-MM-DD for overdue checks.
    function getTodayISO() {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const year = today.getFullYear();
        const month = String(today.getMonth() + 1).padStart(2, "0");
        const day = String(today.getDate()).padStart(2, "0");
        return `${year}-${month}-${day}`;
    }

    // Whether a date is earlier than the current local day.
    function isPastDate(isoDate) {
        return Boolean(isoDate) && isoDate < getTodayISO();
    }

    // User-facing date label for due badges (fixed MM/DD/YYYY format).
    function formatDate(dueDate, dueTime) {
        if (!dueDate) {
            return "No due date";
        }

        const normalizedDate = normalizeDueDate(dueDate);
        if (!normalizedDate) {
            return "No due date";
        }

        const normalizedTime = normalizeDueTime(dueTime);
        if (!normalizedTime) {
            return formatIsoDate(normalizedDate);
        }

        return `${formatIsoDate(normalizedDate)} at ${formatDueTime(normalizedTime)}`;
    }

    // A task is overdue only when incomplete and its due moment has already passed.
    function isOverdue(task) {
        return !task.completed && Boolean(task.dueDate) && getDueMomentKey(task.dueDate, task.dueTime) < getCurrentLocalMinuteKey();
    }

    // Detect due-soon and overdue transitions and announce each due moment only once.
    function processTaskNotifications() {
        if (!areTaskAlertsEnabled()) {
            taskNotificationState = {};
            saveTaskNotificationState();
            return;
        }

        const now = getCurrentLocalMinuteDate();
        const nextState = {};

        tasks.forEach(task => {
            const dueMoment = getDueMomentKey(task.dueDate, task.dueTime);
            const dueMomentDate = getDueMomentDate(task.dueDate, task.dueTime);
            const previousState = taskNotificationState[task.id] && typeof taskNotificationState[task.id] === "object" ? taskNotificationState[task.id] : {};
            const nextTaskState = {};

            if (task.completed || !dueMoment || !dueMomentDate) {
                return;
            }

            const minutesUntilDue = Math.round((dueMomentDate.getTime() - now.getTime()) / 60000);

            if (task.dueTime && minutesUntilDue > 0 && minutesUntilDue <= DUE_SOON_MINUTES) {
                if (previousState.soon === dueMoment || alertDueSoonTask(task)) {
                    nextTaskState.soon = dueMoment;
                }
            }

            if (dueMomentDate.getTime() < now.getTime()) {
                if (previousState.overdue === dueMoment || encourageOverdueTask(task)) {
                    nextTaskState.overdue = dueMoment;
                }
            }

            if (nextTaskState.soon || nextTaskState.overdue) {
                nextState[task.id] = nextTaskState;
            }
        });

        taskNotificationState = nextState;
        saveTaskNotificationState();
    }

    // Keep task alerts and rendering in a predictable order after data changes.
    function syncNotificationsAndRender() {
        renderTasks();
        processTaskNotifications();
    }

    // Refresh overdue UI when the local minute changes, without interrupting active editing.
    function refreshTimedState(force) {
        const currentMinuteKey = getCurrentLocalMinuteKey();
        if (!force && currentMinuteKey === lastTimedRefreshKey) {
            return;
        }

        const activeElement = document.activeElement;
        const isEditingField =
            activeElement &&
            (activeElement.tagName === "INPUT" || activeElement.tagName === "SELECT" || activeElement.tagName === "TEXTAREA");

        if (!force && isEditingField) {
            return;
        }

        lastTimedRefreshKey = currentMinuteKey;
        syncComposerTimeInputState();
        syncNotificationsAndRender();
    }

    // Shared helper for action buttons in task cards.
    function createButton(label, buttonClass, onClick) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = `btn ${buttonClass}`;
        button.textContent = label;
        button.addEventListener("click", onClick);
        return button;
    }

    // Create the inline clear control used by time inputs.
    function createTimeResetButton(label, onClick) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "time-reset";
        button.textContent = "Clear";
        button.setAttribute("aria-label", label);
        button.hidden = true;
        button.disabled = true;
        button.addEventListener("click", onClick);
        return button;
    }

    // Rehydrate tasks from localStorage safely.
    function loadTasks() {
        const parsedTasks = getStoredJSON(STORAGE_KEY);
        const storedTasks = Array.isArray(parsedTasks) ? parsedTasks : [];

        return storedTasks
            .filter(task => task && typeof task.description === "string")
            .map((task, index) => {
                const loadedTask = new Task(
                    normalizeDescription(task.description),
                    task.priority,
                    task.dueDate,
                    task.dueTime,
                    task.createdAt || Date.now() - index,
                    task.id
                );
                loadedTask.completed = Boolean(task.completed);
                return loadedTask;
            })
            .filter(task => isValidDescription(task.description));
    }

    // Persist current in-memory tasks.
    function saveTasks() {
        setStorageItem(STORAGE_KEY, JSON.stringify(tasks));
    }

    // Restore toolbar filters/sort from localStorage.
    function loadViewState() {
        const storedState = getStoredJSON(VIEW_STATE_KEY) || {};
        return {
            activeFilter: normalizeActiveFilter(storedState.activeFilter),
            activePriorityFilter: normalizePriorityFilter(storedState.activePriorityFilter),
            sortMode: normalizeSortMode(storedState.sortMode)
        };
    }

    // Persist toolbar filters/sort so the task view comes back as the user left it.
    function saveViewState() {
        setStorageItem(VIEW_STATE_KEY, JSON.stringify({
            activeFilter,
            activePriorityFilter,
            sortMode
        }));
    }

    // Restore any in-progress task draft from localStorage.
    function loadComposerDraft() {
        const storedDraft = getStoredJSON(COMPOSER_DRAFT_KEY) || {};
        const maxDraftLength = Number(taskInput.maxLength) || 180;

        return {
            description: typeof storedDraft.description === "string" ? storedDraft.description.slice(0, maxDraftLength) : "",
            dueDate: "",
            dueTime: "",
            priority: normalizePriority(storedDraft.priority)
        };
    }

    // Persist the current composer state until submit or explicit site-data removal.
    // Date and time always reset so each new task starts from a fresh schedule state.
    function saveComposerDraft() {
        const draft = {
            description: taskInput.value.slice(0, Number(taskInput.maxLength) || 180),
            priority: getSelectedComposerPriority()
        };

        if (!draft.description && draft.priority === "High") {
            removeStorageItem(COMPOSER_DRAFT_KEY);
            return;
        }

        setStorageItem(COMPOSER_DRAFT_KEY, JSON.stringify(draft));
    }

    // Apply stored toolbar state back onto the controls.
    function restoreViewState() {
        const storedState = loadViewState();
        activeFilter = storedState.activeFilter;
        activePriorityFilter = storedState.activePriorityFilter;
        sortMode = storedState.sortMode;
        priorityFilterSelect.value = activePriorityFilter;
        sortModeSelect.value = sortMode;
        updateFilterButtons();
    }

    // Apply the saved composer draft back onto the form controls.
    function restoreComposerDraft() {
        const storedDraft = loadComposerDraft();
        taskInput.value = storedDraft.description;
        taskDueDateInput.value = storedDraft.dueDate;
        taskDueDateInput.dataset.isoDate = storedDraft.dueDate;
        taskDueTimeInput.value = storedDraft.dueTime;
        setSelectedComposerPriority(storedDraft.priority);
    }

    // Refresh task counters (total/active/done).
    function updateSummary() {
        const done = tasks.filter(task => task.completed).length;
        const total = tasks.length;
        const active = total - done;

        totalCount.textContent = total;
        activeCount.textContent = active;
        doneCount.textContent = done;
    }

    // Status filter predicate.
    function matchesActiveFilter(task) {
        if (activeFilter === "active") {
            return !task.completed;
        }

        if (activeFilter === "completed") {
            return task.completed;
        }

        return true;
    }

    // Priority filter predicate.
    function matchesPriorityFilter(task) {
        return activePriorityFilter === "all" || task.priority === activePriorityFilter;
    }

    // Compare due moments while keeping "no due date" entries last.
    function compareDueDates(taskA, taskB, latestFirst) {
        const missingDateA = !taskA.dueDate;
        const missingDateB = !taskB.dueDate;

        if (missingDateA && missingDateB) {
            return 0;
        }

        if (missingDateA) {
            return 1;
        }

        if (missingDateB) {
            return -1;
        }

        const dueMomentA = getDueMomentKey(taskA.dueDate, taskA.dueTime);
        const dueMomentB = getDueMomentKey(taskB.dueDate, taskB.dueTime);

        if (latestFirst) {
            return dueMomentB.localeCompare(dueMomentA);
        }

        return dueMomentA.localeCompare(dueMomentB);
    }

    // Comparator selected by current sort mode.
    function compareTasks(taskA, taskB) {
        if (sortMode === "oldest") {
            return taskA.createdAt - taskB.createdAt;
        }

        if (sortMode === "priority-desc") {
            return (PRIORITY_RANK[taskB.priority] - PRIORITY_RANK[taskA.priority]) || (taskB.createdAt - taskA.createdAt);
        }

        if (sortMode === "priority-asc") {
            return (PRIORITY_RANK[taskA.priority] - PRIORITY_RANK[taskB.priority]) || (taskB.createdAt - taskA.createdAt);
        }

        if (sortMode === "due-soon") {
            return compareDueDates(taskA, taskB, false) || (taskB.createdAt - taskA.createdAt);
        }

        if (sortMode === "due-late") {
            return compareDueDates(taskA, taskB, true) || (taskB.createdAt - taskA.createdAt);
        }

        return taskB.createdAt - taskA.createdAt;
    }

    // Build filtered/sorted task/index pairs for rendering.
    function getVisibleTaskEntries() {
        return tasks
            .map((task, index) => ({
                task,
                index
            }))
            .filter(entry => matchesActiveFilter(entry.task) && matchesPriorityFilter(entry.task))
            .sort((entryA, entryB) => compareTasks(entryA.task, entryB.task));
    }

    // Keep filter button "active" style in sync with state.
    function updateFilterButtons() {
        filterButtons.forEach(button => {
            button.classList.toggle("is-active", button.dataset.filter === activeFilter);
        });
    }

    // Build priority selector for each task row.
    function createPrioritySelect(index, currentPriority) {
        const select = document.createElement("select");
        select.className = "task-priority";
        select.setAttribute("aria-label", "Task priority");

        PRIORITY_LEVELS.forEach(priority => {
            const option = document.createElement("option");
            option.value = priority;
            option.textContent = priority;
            option.selected = priority === currentPriority;
            select.appendChild(option);
        });

        select.addEventListener("change", function () {
            updateTaskPriority(index, this.value);
        });

        return select;
    }

    // Stack task schedule controls below an overdue badge only when the row cannot fit them side-by-side.
    function syncTaskMetaScheduleLayout() {
        if (!tasksList) {
            return;
        }

        if (taskMetaLayoutFrame && typeof window.cancelAnimationFrame === "function") {
            window.cancelAnimationFrame(taskMetaLayoutFrame);
        }

        const runLayoutCheck = function () {
            taskMetaLayoutFrame = 0;
            const metaRows = Array.from(tasksList.querySelectorAll(".task-meta"));

            metaRows.forEach(meta => {
                const overdueBadge = meta.querySelector(".due-badge.overdue");
                const dateField = meta.querySelector(".date-field--task");
                const timeField = meta.querySelector(".time-field--task");

                if (!overdueBadge || !dateField || !timeField) {
                    meta.classList.remove("task-meta--stack-schedule");
                    return;
                }

                const metaStyles = window.getComputedStyle(meta);
                const gap = parseFloat(metaStyles.columnGap || metaStyles.gap || "0") || 0;
                const availableWidth = meta.clientWidth;

                if (!availableWidth) {
                    meta.classList.remove("task-meta--stack-schedule");
                    return;
                }

                const requiredWidth =
                    overdueBadge.getBoundingClientRect().width +
                    dateField.getBoundingClientRect().width +
                    timeField.getBoundingClientRect().width +
                    (gap * 2) +
                    1;

                meta.classList.toggle("task-meta--stack-schedule", requiredWidth > availableWidth);
            });
        };

        if (typeof window.requestAnimationFrame === "function") {
            taskMetaLayoutFrame = window.requestAnimationFrame(runLayoutCheck);
            return;
        }

        runLayoutCheck();
    }

    // Create one task row and wire all row-level interactions.
    function createTaskItem(task, index) {
        const item = document.createElement("li");
        item.className = `task priority-${task.priority.toLowerCase()}`;
        item.dataset.taskId = task.id;
        if (task.completed) {
            item.classList.add("done");
        }

        const main = document.createElement("div");
        main.className = "task-main";

        const descInput = document.createElement("input");
        descInput.type = "text";
        descInput.className = "task-desc";
        descInput.value = task.description;
        descInput.maxLength = 180;
        descInput.setAttribute("aria-label", `Task ${index + 1} description`);
        descInput.addEventListener("blur", function () {
            updateTaskDescription(index, this.value);
        });
        descInput.addEventListener("keydown", function (event) {
            if (event.key === "Enter") {
                event.preventDefault();
                this.blur();
            }
        });

        const stateText = document.createElement("p");
        stateText.className = "task-state";
        stateText.textContent = task.completed ? "Status: Completed" : "Status: In progress";

        const meta = document.createElement("div");
        meta.className = "task-meta";

        const dueBadge = document.createElement("p");
        dueBadge.className = "due-badge";

        if (task.dueDate) {
            dueBadge.textContent = `${isOverdue(task) ? "Overdue" : "Due"}: ${formatDate(task.dueDate, task.dueTime)}`;
        } else {
            dueBadge.textContent = "No due date";
        }

        if (isOverdue(task)) {
            dueBadge.classList.add("overdue");
        }

        const dueDateInput = document.createElement("input");
        dueDateInput.type = "date";
        dueDateInput.className = "task-due-date";
        dueDateInput.value = task.dueDate;
        applyMinDateConstraint(dueDateInput);
        dueDateInput.setAttribute("aria-label", `Task ${index + 1} due date`);
        dueDateInput.addEventListener("change", function () {
            updateTaskDueDate(index, getDateInputISOValue(this));
        });
        applyDateInputFallback(dueDateInput);
        const dueDateResetButton = createTimeResetButton(`Clear task ${index + 1} due date`, function () {
            updateTaskDueDate(index, "");
        });
        syncDateResetButton(dueDateResetButton, dueDateInput);

        const dueTimeInput = document.createElement("input");
        dueTimeInput.type = "time";
        dueTimeInput.className = "task-due-time";
        dueTimeInput.value = task.dueTime;
        dueTimeInput.setAttribute("aria-label", `Task ${index + 1} due time (optional)`);
        dueTimeInput.addEventListener("change", function () {
            updateTaskDueTime(index, getTimeInputValue(this));
        });
        const dueTimeResetButton = createTimeResetButton(`Clear task ${index + 1} due time`, function () {
            updateTaskDueTime(index, "");
        });
        syncTimeInputAvailability(dueDateInput, dueTimeInput, true);
        applyTimeInputFallback(dueTimeInput);
        syncTimeResetButton(dueTimeResetButton, dueTimeInput);

        const dueDateField = document.createElement("div");
        dueDateField.className = "date-field date-field--task";
        dueDateField.appendChild(dueDateInput);
        dueDateField.appendChild(dueDateResetButton);

        const dueTimeField = document.createElement("div");
        dueTimeField.className = "time-field time-field--task";
        dueTimeField.appendChild(dueTimeInput);
        dueTimeField.appendChild(dueTimeResetButton);
        attachTimeFieldPrompt(dueTimeField, dueTimeInput);
        syncTimeFieldState(dueTimeField, dueTimeInput);

        const scheduleFields = document.createElement("div");
        scheduleFields.className = "task-schedule-fields";
        scheduleFields.appendChild(dueDateField);
        scheduleFields.appendChild(dueTimeField);

        meta.appendChild(dueBadge);
        meta.appendChild(scheduleFields);

        main.appendChild(descInput);
        main.appendChild(stateText);
        main.appendChild(meta);

        const actions = document.createElement("div");
        actions.className = "task-actions";

        const toggleButton = createButton(
            task.completed ? "Undo" : "Complete",
            "btn-secondary",
            function () {
                toggleTaskComplete(index);
            }
        );

        const deleteButton = createButton("Delete", "btn-danger", function () {
            removeTask(index);
        });

        actions.appendChild(toggleButton);
        actions.appendChild(deleteButton);

        item.appendChild(main);
        item.appendChild(createPrioritySelect(index, task.priority));
        item.appendChild(actions);

        return item;
    }

    // Render visible tasks and empty states.
    function renderTasks() {
        tasksList.innerHTML = "";
        const visibleEntries = getVisibleTaskEntries();

        visibleEntries.forEach(({
            task,
            index
        }) => {
            tasksList.appendChild(createTaskItem(task, index));
        });

        if (tasks.length === 0) {
            emptyState.textContent = "No tasks yet. Add your first task above.";
        } else if (visibleEntries.length === 0) {
            emptyState.textContent = "No tasks match the current filters.";
        }

        emptyState.hidden = visibleEntries.length > 0;

        updateSummary();
        syncTaskMetaScheduleLayout();
    }

    // Add a task from form values and reconcile active filters if needed.
    function addTask(description, priority, dueDate, dueTime) {
        const normalizedDescription = normalizeDescription(description);
        const normalizedDueDate = normalizeDueDate(dueDate);
        const normalizedDueTime = normalizedDueDate ? normalizeDueTime(dueTime) : "";

        if (!normalizedDescription) {
            alert("Please add a task.");
            return false;
        }

        if (/[<>]/.test(normalizedDescription)) {
            alert("Please enter a valid task description without HTML characters.");
            return false;
        }

        if (isPastDate(normalizedDueDate)) {
            alert("Please choose today or a future date.");
            syncDateInputPresentation(taskDueDateInput, IOS_DATE_PLACEHOLDER);
            return false;
        }

        if (isPastTimeForDate(normalizedDueDate, normalizedDueTime)) {
            alert("Please choose the current time or a future time.");
            return false;
        }

        const newTask = new Task(normalizedDescription, priority, normalizedDueDate, normalizedDueTime, Date.now());
        tasks.unshift(newTask);

        let shouldUpdateFilterUI = false;

        if (!matchesActiveFilter(newTask)) {
            activeFilter = "all";
            shouldUpdateFilterUI = true;
        }

        if (!matchesPriorityFilter(newTask)) {
            activePriorityFilter = "all";
            priorityFilterSelect.value = "all";
        }

        if (shouldUpdateFilterUI) {
            updateFilterButtons();
        }

        saveTasks();
        saveViewState();
        syncNotificationsAndRender();
        scrollToFirstTask();
        return true;
    }

    // Remove task at index.
    function removeTask(index) {
        tasks.splice(index, 1);
        saveTasks();
        syncNotificationsAndRender();
    }

    // Toggle completion for task at index.
    function toggleTaskComplete(index) {
        const task = tasks[index];
        const wasCompleted = task.completed;
        task.toggleComplete();

        saveTasks();
        syncNotificationsAndRender();

        if (!wasCompleted && task.completed) {
            celebrateTaskCompletion(task);
        }
    }

    // Save edited task text after validation.
    function updateTaskDescription(index, description) {
        const normalizedDescription = normalizeDescription(description);
        if (!normalizedDescription) {
            alert("Task description cannot be empty.");
            renderTasks();
            return;
        }

        if (/[<>]/.test(normalizedDescription)) {
            alert("Invalid input. HTML tags are not allowed.");
            renderTasks();
            return;
        }

        tasks[index].description = normalizedDescription;
        saveTasks();
        syncNotificationsAndRender();
    }

    // Save edited priority value.
    function updateTaskPriority(index, priority) {
        tasks[index].priority = normalizePriority(priority);
        saveTasks();
        syncNotificationsAndRender();
    }

    // Save edited due date value.
    function updateTaskDueDate(index, dueDate) {
        const normalizedDueDate = normalizeDueDate(dueDate);

        if (isPastDate(normalizedDueDate)) {
            alert("Past dates are not allowed. Please choose today or a future date.");
            renderTasks();
            return;
        }

        tasks[index].dueDate = normalizedDueDate;
        if (!normalizedDueDate) {
            tasks[index].dueTime = "";
        } else if (isPastTimeForDate(normalizedDueDate, tasks[index].dueTime)) {
            tasks[index].dueTime = "";
            alert("Past times are not allowed for today. Please choose the current time or a future time.");
        }
        saveTasks();
        syncNotificationsAndRender();
    }

    // Save edited due time value.
    function updateTaskDueTime(index, dueTime) {
        const normalizedDueTime = normalizeDueTime(dueTime);

        if (!tasks[index].dueDate) {
            if (normalizedDueTime) {
                promptForDateBeforeTime();
            }
            tasks[index].dueTime = "";
            saveTasks();
            syncNotificationsAndRender();
            return;
        }

        if (isPastTimeForDate(tasks[index].dueDate, normalizedDueTime)) {
            alert("Past times are not allowed for today. Please choose the current time or a future time.");
            renderTasks();
            return;
        }

        tasks[index].dueTime = normalizedDueTime;
        saveTasks();
        syncNotificationsAndRender();
    }

    // Bring newly added item into view.
    function scrollToFirstTask() {
        const firstTask = tasksList.firstElementChild;
        if (firstTask) {
            firstTask.scrollIntoView({
                behavior: "smooth",
                block: "nearest"
            });
        }
    }

    // Apply selected theme and persist preference.
    function applyTheme(theme) {
        const resolvedTheme = theme === "dark" ? "dark" : "light";
        const nextThemeLabel = resolvedTheme === "dark" ? "Switch to light mode" : "Switch to dark mode";
        document.documentElement.setAttribute("data-theme", resolvedTheme);
        themeToggle.setAttribute("aria-pressed", resolvedTheme === "dark" ? "true" : "false");
        themeToggle.setAttribute("aria-label", nextThemeLabel);
        themeToggle.setAttribute("title", nextThemeLabel);
        setStorageItem(THEME_KEY, resolvedTheme);
    }

    // Initialize theme from localStorage, then system preference fallback.
    function initializeTheme() {
        const storedTheme = getStorageItem(THEME_KEY);
        if (storedTheme === "dark" || storedTheme === "light") {
            applyTheme(storedTheme);
            return;
        }

        const prefersDark =
            typeof window.matchMedia === "function" &&
            window.matchMedia("(prefers-color-scheme: dark)").matches;

        applyTheme(prefersDark ? "dark" : "light");
    }

    // Form submission: add task and reset composer inputs.
    taskForm.addEventListener("submit", function (event) {
        event.preventDefault();
        const selectedPriority = document.querySelector("input[name='priority']:checked").value;
        const description = taskInput.value;
        const dueDate = getDateInputISOValue(taskDueDateInput);
        const dueTime = taskDueTimeInput.disabled ? "" : getTimeInputValue(taskDueTimeInput);

        if (addTask(description, selectedPriority, dueDate, dueTime)) {
            taskInput.value = "";
            clearDateInputValue(taskDueDateInput);
            clearTimeInputValue(taskDueTimeInput);
            setSelectedComposerPriority("High");
            syncComposerTimeInputState();
            saveComposerDraft();

            if (!shouldShowNotificationModal() || !openNotificationModal()) {
                taskInput.focus();
            }
        }
    });

    // Status filter buttons.
    filterButtons.forEach(button => {
        button.addEventListener("click", function () {
            activeFilter = this.dataset.filter;
            updateFilterButtons();
            saveViewState();
            renderTasks();
        });
    });

    // Priority filter dropdown.
    priorityFilterSelect.addEventListener("change", function () {
        activePriorityFilter = this.value;
        saveViewState();
        renderTasks();
    });

    // Sort mode dropdown.
    sortModeSelect.addEventListener("change", function () {
        sortMode = this.value;
        saveViewState();
        renderTasks();
    });

    // Theme toggle button.
    themeToggle.addEventListener("click", function () {
        const currentTheme = document.documentElement.getAttribute("data-theme");
        applyTheme(currentTheme === "dark" ? "light" : "dark");
    });

    if (notificationModalConfirmButton) {
        notificationModalConfirmButton.addEventListener("click", function () {
            resolveNotificationPrompt("accepted");
            setNotificationModalState("enabled");
            processTaskNotifications();
            notificationModalDismissButton.focus();
        });
    }

    if (notificationModalDeclineButton) {
        notificationModalDeclineButton.addEventListener("click", function () {
            resolveNotificationPrompt("declined");
            closeNotificationModal();
        });
    }

    if (notificationModalDismissButton) {
        notificationModalDismissButton.addEventListener("click", function () {
            closeNotificationModal();
        });
    }

    if (taskDueTimeResetButton) {
        taskDueTimeResetButton.addEventListener("click", function () {
            clearTimeInputValue(taskDueTimeInput);
            syncComposerTimeInputState(true);
            saveComposerDraft();
        });
    }
    if (taskDueDateResetButton) {
        taskDueDateResetButton.addEventListener("click", function () {
            clearDateInputValue(taskDueDateInput);
            syncComposerTimeInputState();
            saveComposerDraft();
        });
    }
    attachTimeFieldPrompt(taskDueTimeField, taskDueTimeInput);

    // Initial boot sequence.
    applyMinDateConstraint(taskDueDateInput);
    restoreComposerDraft();
    applyDateInputFallback(taskDueDateInput);
    syncComposerTimeInputState(true);
    applyTimeInputFallback(taskDueTimeInput);
    syncComposerTimeInputState(true);
    restoreViewState();
    initializeTheme();
    pruneTaskNotificationState();
    syncNotificationsAndRender();

    window.setInterval(function () {
        refreshTimedState(false);
    }, 30000);

    window.addEventListener("focus", function () {
        refreshTimedState(true);
    });

    window.addEventListener("resize", function () {
        syncTaskMetaScheduleLayout();
    });

    document.addEventListener("visibilitychange", function () {
        if (!document.hidden) {
            refreshTimedState(true);
        }
    });

    // Draft listeners are attached after iOS fallback setup so saved dates use normalized values.
    taskInput.addEventListener("input", saveComposerDraft);
    taskDueDateInput.addEventListener("input", function () {
        syncComposerTimeInputState();
        saveComposerDraft();
    });
    taskDueDateInput.addEventListener("change", function () {
        syncComposerTimeInputState();
        saveComposerDraft();
    });
    taskDueDateInput.addEventListener("blur", function () {
        syncComposerTimeInputState();
        saveComposerDraft();
    });
    taskDueTimeInput.addEventListener("input", function () {
        syncTimeResetButton(taskDueTimeResetButton, taskDueTimeInput);
        saveComposerDraft();
    });
    taskDueTimeInput.addEventListener("change", function () {
        syncTimeResetButton(taskDueTimeResetButton, taskDueTimeInput);
        saveComposerDraft();
    });
    taskDueTimeInput.addEventListener("blur", function () {
        syncTimeResetButton(taskDueTimeResetButton, taskDueTimeInput);
    });
    composerPriorityInputs.forEach(input => {
        input.addEventListener("change", saveComposerDraft);
    });

    saveComposerDraft();
    saveViewState();
})();
