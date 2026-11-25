<template>
  <div class="multiTenant">
    <section class="developmentNotice" aria-labelledby="developmentTitle">
      <div class="noticeContent">
        <icon-barrier-block :size="36" aria-hidden="true" />
        <h3 id="developmentTitle">正在开发</h3>
        <p>见白的多租户能力正在开发中。</p>
      </div>
    </section>

    <section class="businessContact" aria-labelledby="businessTitle">
      <div class="contactInfo">
        <h3 id="businessTitle">商务合作</h3>
      </div>
    </section>
  </div>
</template>

<style lang="scss" scoped>
.multiTenant {
  display: flex;
  flex-direction: column;
  gap: 24px;
  padding: 0 4px 8px;

  .developmentNotice {
    border: 1px solid var(--el-border-color-light);
    border-radius: var(--el-border-radius-base);
    background: var(--el-fill-color-extra-light);

    .noticeContent {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 12px;
      padding: 28px 20px;
      text-align: center;

      > svg {
        color: var(--el-text-color-secondary);
      }

      h3 {
        margin: 0;
        color: var(--el-text-color-primary);
        font-size: 16px;
      }

      p {
        margin: 0;
        color: var(--el-text-color-regular);
        font-size: 13px;
        line-height: 1.7;
      }
    }
  }

  .businessContact {
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 20px;
    padding: 20px;
    border: 1px solid var(--el-border-color-light);
    border-radius: var(--el-border-radius-base);
    background: var(--el-bg-color);

    .contactInfo {
      flex: 1 1 220px;
      min-width: 0;

      h3 {
        margin: 0;
        color: var(--el-text-color-primary);
        font-size: 14px;
      }

    }

    @media (max-width: 700px) {
      padding: 12px;
    }
  }
}
</style>
