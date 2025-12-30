/**
 * ProTools 简单测试脚本
 * 验证 merge_files 核心功能
 */

import { collectFiles } from "./core/io.js";
import { generateOutput, processFile } from "./core/merge.js";
import type { MergeMode } from "./types/merge.js";

async function test() {
    console.log("=== ProTools 功能测试 ===\n");

    // 测试 1: 收集当前项目的 TypeScript 文件
    console.log("测试 1: 文件收集");
    const files = await collectFiles(
        ["/home/hotic/Work/ProTools/src"],
        [".ts"],
        undefined,
        false
    );
    console.log(`  收集到 ${(files as string[]).length} 个 .ts 文件`);

    // 测试 2: 处理单个文件（compact 模式）
    console.log("\n测试 2: 单文件处理（compact 模式）");
    const firstFile = (files as string[])[0];
    const processed = processFile(firstFile, "compact", "/home/hotic/Work/ProTools/src");
    console.log(`  文件: ${processed?.relativePath}`);
    console.log(`  语言: ${processed?.language}`);
    console.log(`  处理后长度: ${processed?.content.length} 字符`);

    // 测试 3: 生成合并输出
    console.log("\n测试 3: 合并输出生成");
    const output = generateOutput(files as string[], "compact", false, "/home/hotic/Work/ProTools/src");
    console.log(`  输出长度: ${output.length} 字符`);
    console.log(`  预估 token: ${Math.round(output.length / 4)}`);

    // 测试 4: skeleton 模式
    console.log("\n测试 4: skeleton 模式输出");
    const skeletonOutput = generateOutput(files as string[], "skeleton", false, "/home/hotic/Work/ProTools/src");
    console.log(`  输出长度: ${skeletonOutput.length} 字符`);
    console.log(`  压缩比: ${((1 - skeletonOutput.length / output.length) * 100).toFixed(1)}%`);

    console.log("\n=== 测试完成 ===");
}

test().catch(console.error);
