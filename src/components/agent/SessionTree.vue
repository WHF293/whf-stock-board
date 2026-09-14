<script setup lang="ts">
import { reactive, ref } from 'vue';
import { VueDraggable } from 'vue-draggable-plus';
import { useAgentStore } from '@/stores/agent';
import { UNGROUPED_LABEL, SESSION_DEFAULT_TITLE } from '@/constants/agent.constants';
import type { ChatSession } from '@/types/agent.types';
import MenuIcon from '@/components/ui/MenuIcon.vue';
import BaseModal from '@/components/ui/BaseModal.vue';
import BaseButton from '@/components/ui/BaseButton.vue';
import BaseConfirmModal from '@/components/ui/BaseConfirmModal.vue';
import { formatRelativeTime } from '@/utils/format-relative-time';

/**
 * 会话树（方案 §6.1「空间」分组样式）
 *
 * - 分组可折叠、可拖拽排序（grip 手柄）；末尾固定「未分组」兜底组（不参与组排序）；
 * - 会话行 = 标题 + 灰色相对时间；hover 出 ⋯ 菜单（重命名/移动分组/置顶/删除）；
 * - 会话拖拽支持跨组移动（同一 drag group）；置顶会话始终浮在组内最前；
 * - 删除均有二次确认；会话删除级联删消息。
 */
const store = useAgentStore();

/* --------------------------------- 折叠状态 -------------------------------- */

/** 未分组在折叠表里的虚拟 key */
const UNGROUPED_KEY = -1;

/** 折叠状态（key：分组 id / -1 = 未分组） */
const collapsed = reactive<Record<number, boolean>>({});

/**
 * 切换分组折叠
 * @param key 分组 key
 */
const toggleCollapse = (key: number): void => {
  collapsed[key] = !collapsed[key];
};

/* --------------------------------- 菜单状态 -------------------------------- */

/** 当前打开的 ⋯ 菜单（`s<id>` 会话 / `g<id>` 分组；null 关闭） */
const openMenu = ref<string | null>(null);

/**
 * 切换菜单
 * @param key 菜单 key
 */
const toggleMenu = (key: string): void => {
  openMenu.value = openMenu.value === key ? null : key;
};

/** 关闭菜单（遮罩层点击） */
const closeMenu = (): void => {
  openMenu.value = null;
};

/* --------------------------------- 拖拽排序 -------------------------------- */

/**
 * 会话拖拽落库（支持跨组：落点列表决定归属）
 * @param groupId 落点分组 id（null = 未分组）
 * @param list 拖拽后的会话数组
 */
const onSessionsDrop = (groupId: number | null, list: ChatSession[]): void => {
  void store.applySessionOrders(
    list.map((s, index) => ({ id: s.id, sortOrder: index, groupId })),
  );
};

/**
 * 分组拖拽排序落库
 * @param orderedIds 拖拽后的分组 id 顺序
 */
const onGroupsDrop = (orderedIds: number[]): void => {
  void store.applyGroupOrders(orderedIds);
};

/* --------------------------------- 弹窗状态 -------------------------------- */

/** 新建分组 */
const newGroupModalOpen = ref(false);
const newGroupName = ref('');

/** 重命名（session/group 共用一套输入弹窗） */
const renameModalOpen = ref(false);
const renameTarget = ref<{ kind: 'session' | 'group'; id: number } | null>(null);
const renameValue = ref('');

/** 移动分组 */
const moveModalOpen = ref(false);
const moveSessionId = ref<number | null>(null);
const moveTargetGroupId = ref<number | null>(null);

/** 删除确认（session/group 共用） */
const deleteTarget = ref<{ kind: 'session' | 'group'; id: number; label: string } | null>(null);
const deleteModalOpen = ref(false);

/**
 * 打开重命名弹窗
 * @param kind
 * @param id
 * @param current
 */
const openRename = (kind: 'session' | 'group', id: number, current: string): void => {
  renameTarget.value = { kind, id };
  renameValue.value = current;
  renameModalOpen.value = true;
  closeMenu();
};

/**
 * 打开移动分组弹窗
 * @param session
 */
const openMove = (session: ChatSession): void => {
  moveSessionId.value = session.id;
  moveTargetGroupId.value = session.groupId;
  moveModalOpen.value = true;
  closeMenu();
};

/**
 * 打开删除确认弹窗
 * @param kind
 * @param id
 * @param label
 */
const openDelete = (kind: 'session' | 'group', id: number, label: string): void => {
  deleteTarget.value = { kind, id, label };
  deleteModalOpen.value = true;
  closeMenu();
};

/** 确认重命名 */
const confirmRename = (): void => {
  if (!renameTarget.value) return;
  const { kind, id } = renameTarget.value;
  if (kind === 'session') void store.renameSession(id, renameValue.value);
  else void store.renameGroup(id, renameValue.value);
  renameModalOpen.value = false;
};

/** 确认移动分组 */
const confirmMove = (): void => {
  if (moveSessionId.value === null) return;
  void store.moveSessionToGroup(moveSessionId.value, moveTargetGroupId.value);
  moveModalOpen.value = false;
};

/** 确认删除（危险操作，会话级联删消息 / 分组会话回落未分组） */
const confirmDelete = (): void => {
  if (!deleteTarget.value) return;
  const { kind, id } = deleteTarget.value;
  if (kind === 'session') void store.removeSession(id);
  else void store.removeGroup(id);
  deleteModalOpen.value = false;
};

/** 提交新建分组 */
const confirmNewGroup = (): void => {
  void store.addGroup(newGroupName.value);
  newGroupName.value = '';
  newGroupModalOpen.value = false;
};

/* --------------------------------- 会话选择 -------------------------------- */

/**
 * 选中会话
 * @param id 会话 id
 */
const selectSession = (id: number): void => {
  store.currentSessionId = id;
};
</script>

<template>
  <div class="space-y-1">
    <!-- 分组列表（grip 手柄拖拽排序） -->
    <VueDraggable
      :model-value="store.groups.map((g) => g.id)"
      tag="div"
      :animation="150"
      handle=".group-handle"
      :force-fallback="true"
      fallback-class="sortable-fallback bg-surface shadow-lg ring-1 ring-flat-weak"
      ghost-class="opacity-40"
      chosen-class="bg-flat-weak"
      class="space-y-1"
      @update:model-value="onGroupsDrop"
    >
      <section v-for="group in store.groups" :key="group.id" class="rounded-lg">
        <!-- 分组标题行 -->
        <div
          class="group flex select-none items-center gap-1.5 rounded-lg px-1.5 py-1.5 hover:bg-flat-weak"
        >
          <MenuIcon
            name="grip"
            :size="14"
            class="group-handle hidden cursor-grab text-text-tertiary active:cursor-grabbing group-hover:block"
          />
          <button
            type="button"
            class="flex min-w-0 flex-1 items-center gap-1.5 text-left"
            :aria-expanded="!collapsed[group.id]"
            @click="toggleCollapse(group.id)"
          >
            <MenuIcon
              :name="collapsed[group.id] ? 'chevronRight' : 'chevronDown'"
              :size="14"
              class="shrink-0 text-text-tertiary"
            />
            <MenuIcon name="folder" :size="14" class="shrink-0 text-text-tertiary" />
            <span class="truncate text-xs font-medium text-text-tertiary">
              {{ group.name }}（{{ store.sessionsOfGroup(group.id).length }}）
            </span>
          </button>
          <div class="relative">
            <button
              type="button"
              class="rounded p-1 text-text-tertiary opacity-0 hover:bg-flat-weak hover:text-text group-hover:opacity-100"
              aria-label="分组操作"
              @click.stop="toggleMenu(`g${group.id}`)"
            >
              <MenuIcon name="dots" :size="14" />
            </button>
            <!-- 分组菜单 -->
            <div
              v-if="openMenu === `g${group.id}`"
              class="absolute right-0 top-7 z-50 w-28 rounded-lg border border-flat-weak bg-surface py-1 shadow-lg"
            >
              <button
                type="button"
                class="block w-full px-3 py-1.5 text-left text-xs text-text-secondary hover:bg-flat-weak hover:text-text"
                @click="openRename('group', group.id, group.name)"
              >
                重命名
              </button>
              <button
                type="button"
                class="block w-full px-3 py-1.5 text-left text-xs text-up hover:bg-flat-weak"
                @click="openDelete('group', group.id, group.name)"
              >
                删除分组
              </button>
            </div>
          </div>
        </div>

        <!-- 组内会话（跨组拖拽） -->
        <VueDraggable
          v-if="!collapsed[group.id]"
          :model-value="store.sessionsOfGroup(group.id)"
          tag="ul"
          :animation="150"
          handle=".session-handle"
          :force-fallback="true"
          group="agent-sessions"
          fallback-class="sortable-fallback bg-surface shadow-lg"
          ghost-class="opacity-40"
          chosen-class="bg-flat-weak"
          class="space-y-0.5 pl-4"
          @update:model-value="onSessionsDrop(group.id, $event)"
        >
          <li
            v-for="session in store.sessionsOfGroup(group.id)"
            :key="session.id"
            class="group/session relative flex items-center rounded-lg"
            :class="
              store.currentSessionId === session.id ? 'bg-flat-weak' : 'hover:bg-flat-weak/60'
            "
          >
            <MenuIcon
              name="grip"
              :size="14"
              class="session-handle absolute left-0 hidden cursor-grab text-text-tertiary active:cursor-grabbing group-hover/session:block"
            />
            <button
              type="button"
              class="flex min-w-0 flex-1 items-center gap-2 py-2 pl-2 pr-1 text-left"
              @click="selectSession(session.id)"
            >
              <MenuIcon
                v-if="session.pinned"
                name="pin"
                :size="12"
                class="shrink-0 text-primary"
              />
              <span
                class="min-w-0 flex-1 truncate text-sm"
                :class="
                  store.currentSessionId === session.id
                    ? 'font-medium text-text'
                    : 'text-text-secondary'
                "
              >
                {{ session.title }}
              </span>
              <span class="shrink-0 text-xs text-text-tertiary">
                {{ formatRelativeTime(session.updatedAt) }}
              </span>
            </button>
            <div class="relative pr-1">
              <button
                type="button"
                class="rounded p-1 text-text-tertiary opacity-0 hover:bg-flat-weak hover:text-text group-hover/session:opacity-100"
                aria-label="会话操作"
                @click.stop="toggleMenu(`s${session.id}`)"
              >
                <MenuIcon name="dots" :size="14" />
              </button>
              <!-- 会话菜单 -->
              <div
                v-if="openMenu === `s${session.id}`"
                class="absolute right-0 top-7 z-50 w-28 rounded-lg border border-flat-weak bg-surface py-1 shadow-lg"
              >
                <button
                  type="button"
                  class="block w-full px-3 py-1.5 text-left text-xs text-text-secondary hover:bg-flat-weak hover:text-text"
                  @click="openRename('session', session.id, session.title)"
                >
                  重命名
                </button>
                <button
                  type="button"
                  class="block w-full px-3 py-1.5 text-left text-xs text-text-secondary hover:bg-flat-weak hover:text-text"
                  @click="openMove(session)"
                >
                  移动分组
                </button>
                <button
                  type="button"
                  class="block w-full px-3 py-1.5 text-left text-xs text-text-secondary hover:bg-flat-weak hover:text-text"
                  @click="void store.togglePin(session.id); closeMenu()"
                >
                  {{ session.pinned ? '取消置顶' : '置顶' }}
                </button>
                <button
                  type="button"
                  class="block w-full px-3 py-1.5 text-left text-xs text-up hover:bg-flat-weak"
                  @click="openDelete('session', session.id, session.title)"
                >
                  删除会话
                </button>
              </div>
            </div>
          </li>
        </VueDraggable>
      </section>
    </VueDraggable>

    <!-- 未分组（固定在最后，不参与组排序） -->
    <section class="rounded-lg">
      <div
        class="group flex select-none items-center gap-1.5 rounded-lg px-1.5 py-1.5 hover:bg-flat-weak"
      >
        <button
          type="button"
          class="flex min-w-0 flex-1 items-center gap-1.5 text-left"
          :aria-expanded="!collapsed[UNGROUPED_KEY]"
          @click="toggleCollapse(UNGROUPED_KEY)"
        >
          <MenuIcon
            :name="collapsed[UNGROUPED_KEY] ? 'chevronRight' : 'chevronDown'"
            :size="14"
            class="shrink-0 text-text-tertiary"
          />
          <MenuIcon name="folder" :size="14" class="shrink-0 text-text-tertiary" />
          <span class="truncate text-xs font-medium text-text-tertiary">
            {{ UNGROUPED_LABEL }}（{{ store.sessionsOfGroup(null).length }}）
          </span>
        </button>
      </div>
      <VueDraggable
        v-if="!collapsed[UNGROUPED_KEY]"
        :model-value="store.sessionsOfGroup(null)"
        tag="ul"
        :animation="150"
        handle=".session-handle"
        :force-fallback="true"
        group="agent-sessions"
        fallback-class="sortable-fallback bg-surface shadow-lg"
        ghost-class="opacity-40"
        chosen-class="bg-flat-weak"
        class="space-y-0.5 pl-4"
        @update:model-value="onSessionsDrop(null, $event)"
      >
        <li
          v-for="session in store.sessionsOfGroup(null)"
          :key="session.id"
          class="group/session relative flex items-center rounded-lg"
          :class="store.currentSessionId === session.id ? 'bg-flat-weak' : 'hover:bg-flat-weak/60'"
        >
          <MenuIcon
            name="grip"
            :size="14"
            class="session-handle absolute left-0 hidden cursor-grab text-text-tertiary active:cursor-grabbing group-hover/session:block"
          />
          <button
            type="button"
            class="flex min-w-0 flex-1 items-center gap-2 py-2 pl-2 pr-1 text-left"
            @click="selectSession(session.id)"
          >
            <MenuIcon v-if="session.pinned" name="pin" :size="12" class="shrink-0 text-primary" />
            <span
              class="min-w-0 flex-1 truncate text-sm"
              :class="
                store.currentSessionId === session.id ? 'font-medium text-text' : 'text-text-secondary'
              "
            >
              {{ session.title }}
            </span>
            <span class="shrink-0 text-xs text-text-tertiary">
              {{ formatRelativeTime(session.updatedAt) }}
            </span>
          </button>
          <div class="relative pr-1">
            <button
              type="button"
              class="rounded p-1 text-text-tertiary opacity-0 hover:bg-flat-weak hover:text-text group-hover/session:opacity-100"
              aria-label="会话操作"
              @click.stop="toggleMenu(`s${session.id}`)"
            >
              <MenuIcon name="dots" :size="14" />
            </button>
            <div
              v-if="openMenu === `s${session.id}`"
              class="absolute right-0 top-7 z-50 w-28 rounded-lg border border-flat-weak bg-surface py-1 shadow-lg"
            >
              <button
                type="button"
                class="block w-full px-3 py-1.5 text-left text-xs text-text-secondary hover:bg-flat-weak hover:text-text"
                @click="openRename('session', session.id, session.title)"
              >
                重命名
              </button>
              <button
                type="button"
                class="block w-full px-3 py-1.5 text-left text-xs text-text-secondary hover:bg-flat-weak hover:text-text"
                @click="openMove(session)"
              >
                移动分组
              </button>
              <button
                type="button"
                class="block w-full px-3 py-1.5 text-left text-xs text-text-secondary hover:bg-flat-weak hover:text-text"
                @click="void store.togglePin(session.id); closeMenu()"
              >
                {{ session.pinned ? '取消置顶' : '置顶' }}
              </button>
              <button
                type="button"
                class="block w-full px-3 py-1.5 text-left text-xs text-up hover:bg-flat-weak"
                @click="openDelete('session', session.id, session.title)"
              >
                删除会话
              </button>
            </div>
          </div>
        </li>
      </VueDraggable>
    </section>

    <!-- 空态 / 新建分组入口 -->
    <div
      v-if="store.sessions.length === 0 && store.groups.length === 0"
      class="rounded-lg border border-dashed border-flat-weak px-3 py-4 text-center"
    >
      <p class="text-xs leading-5 text-text-tertiary">
        暂无会话<br />
        点击上方「新建对话」开始
      </p>
    </div>
    <button
      type="button"
      class="mt-2 flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-primary py-2 text-xs text-text-tertiary transition-colors hover:text-primary"
      @click="newGroupModalOpen = true"
    >
      <MenuIcon name="plus" :size="12" />
      新建分组
    </button>

    <!-- ⋯ 菜单遮罩（点击空白处关闭） -->
    <div v-if="openMenu" class="fixed inset-0 z-40" @click="closeMenu" />

    <!-- 新建分组弹窗 -->
    <BaseModal v-model:open="newGroupModalOpen" title="新建分组" max-width-class="max-w-sm">
      <input
        v-model="newGroupName"
        type="text"
        class="w-full rounded-lg border border-flat-weak bg-transparent px-3 py-2 text-sm text-text outline-none focus:border-primary"
        placeholder="分组名称"
        @keydown.enter="confirmNewGroup"
      />
      <template #footer>
        <BaseButton variant="ghost" @click="newGroupModalOpen = false">取消</BaseButton>
        <BaseButton variant="primary" :disabled="!newGroupName.trim()" @click="confirmNewGroup">
          创建
        </BaseButton>
      </template>
    </BaseModal>

    <!-- 重命名弹窗 -->
    <BaseModal v-model:open="renameModalOpen" title="重命名" max-width-class="max-w-sm">
      <input
        v-model="renameValue"
        type="text"
        class="w-full rounded-lg border border-flat-weak bg-transparent px-3 py-2 text-sm text-text outline-none focus:border-primary"
        @keydown.enter="confirmRename"
      />
      <template #footer>
        <BaseButton variant="ghost" @click="renameModalOpen = false">取消</BaseButton>
        <BaseButton variant="primary" :disabled="!renameValue.trim()" @click="confirmRename">
          保存
        </BaseButton>
      </template>
    </BaseModal>

    <!-- 移动分组弹窗 -->
    <BaseModal v-model:open="moveModalOpen" title="移动分组" max-width-class="max-w-sm">
      <div class="space-y-1">
        <label
          v-for="group in store.groups"
          :key="group.id"
          class="flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors"
          :class="
            moveTargetGroupId === group.id
              ? 'border-primary bg-primary-weak text-text'
              : 'border-flat-weak text-text-secondary hover:border-primary'
          "
        >
          <input
            v-model="moveTargetGroupId"
            type="radio"
            :value="group.id"
            class="accent-primary"
            name="move-target-group"
          />
          {{ group.name }}
        </label>
        <label
          class="flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors"
          :class="
            moveTargetGroupId === null
              ? 'border-primary bg-primary-weak text-text'
              : 'border-flat-weak text-text-secondary hover:border-primary'
          "
        >
          <input
            v-model="moveTargetGroupId"
            type="radio"
            :value="null"
            class="accent-primary"
            name="move-target-group"
          />
          {{ UNGROUPED_LABEL }}
        </label>
      </div>
      <template #footer>
        <BaseButton variant="ghost" @click="moveModalOpen = false">取消</BaseButton>
        <BaseButton variant="primary" @click="confirmMove">移动</BaseButton>
      </template>
    </BaseModal>

    <!-- 删除确认 -->
    <BaseConfirmModal
      v-model:open="deleteModalOpen"
      :title="deleteTarget?.kind === 'group' ? '删除分组' : '删除会话'"
      :content="
        deleteTarget?.kind === 'group'
          ? `删除分组「${deleteTarget?.label}」？组内会话将移入「${UNGROUPED_LABEL}」。`
          : `删除会话「${deleteTarget?.label ?? SESSION_DEFAULT_TITLE}」及其全部消息，不可恢复。`
      "
      ok-text="删除"
      ok-variant="danger"
      @ok="confirmDelete"
    />
  </div>
</template>
