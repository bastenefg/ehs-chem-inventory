# Third-party notices

ChemInventory 2.2.2 includes open-source libraries listed below. The application's own code is licensed under the [MIT license](LICENSE); this does not replace the licenses of its dependencies. The same notices, license texts, and Public Suffix List source are included inside the APK in `assets/open-source/`.

This inventory follows the resolved `releaseRuntimeClasspath` for version 2.2.2. It covers 81 unique dependency coordinates (84 resolved artifacts, including variant artifacts), plus native runtime components and the Public Suffix List. Test libraries, Android Studio, Gradle, and build plugins are not shipped as app runtime dependencies. Annotations and resource-only artifacts are included in this inventory even where they do not contribute executable classes. No upstream library source was modified for this release.

## Licenses and credits

| Components | Authors / upstream | License and included notices |
| --- | --- | --- |
| AndroidX, including Activity, CameraX, Compose, Lifecycle, and support libraries | The Android Open Source Project and contributors; [AndroidX source](https://android.googlesource.com/platform/frameworks/support/) | [Apache 2.0](app/src/main/assets/open-source/Apache-2.0.txt) |
| Kotlin standard library and JDK compatibility libraries | JetBrains s.r.o. and Kotlin Programming Language contributors; [Kotlin source](https://github.com/JetBrains/kotlin/tree/v2.0.21/libraries/stdlib) | [Apache 2.0](app/src/main/assets/open-source/Apache-2.0.txt); additional math attribution below |
| Kotlin coroutines | JetBrains s.r.o. and respective authors and developers; [coroutines source](https://github.com/Kotlin/kotlinx.coroutines/tree/1.7.3) | [Apache 2.0](app/src/main/assets/open-source/Apache-2.0.txt), [upstream NOTICE](app/src/main/assets/open-source/Kotlinx-coroutines-NOTICE.txt) |
| JetBrains annotations | JetBrains s.r.o. and contributors; [annotations source](https://github.com/JetBrains/java-annotations) | [Apache 2.0](app/src/main/assets/open-source/Apache-2.0.txt) |
| OkHttp and Okio | Square, Inc. and contributors; [OkHttp source](https://github.com/square/okhttp/tree/parent-4.12.0), [Okio source](https://github.com/square/okio/tree/parent-3.6.0) | [Apache 2.0](app/src/main/assets/open-source/Apache-2.0.txt); Public Suffix List has separate terms below |
| AutoValue annotations and Guava ListenableFuture | Google LLC and contributors; [AutoValue source](https://github.com/google/auto), [Guava source](https://github.com/google/guava) | [Apache 2.0](app/src/main/assets/open-source/Apache-2.0.txt) |
| JSpecify annotations | The JSpecify Authors; [JSpecify source](https://github.com/jspecify/jspecify/tree/v1.0.0) | [Apache 2.0](app/src/main/assets/open-source/Apache-2.0.txt) |
| LibYuv, incorporated in CameraX image processing | Copyright 2011 The LibYuv Project Authors. All rights reserved.; [LibYuv source](https://chromium.googlesource.com/libyuv/libyuv/) | [BSD license](app/src/main/assets/open-source/Libyuv-LICENSE.txt), [patent grant](app/src/main/assets/open-source/Libyuv-PATENTS.txt), [authors](app/src/main/assets/open-source/Libyuv-AUTHORS.txt) |
| LLVM C++ runtime portions used by bundled native libraries | The LLVM Project and its contributors; [LLVM source](https://github.com/llvm/llvm-project) | [libc++ license](app/src/main/assets/open-source/LLVM-libcxx-LICENSE.txt), [libc++abi license](app/src/main/assets/open-source/LLVM-libcxxabi-LICENSE.txt); includes Apache 2.0 with LLVM exceptions and legacy terms |

Kotlin's upstream [license inventory](https://github.com/JetBrains/kotlin/blob/v2.0.21/license/README.md) attributes its JVM `MathJVM.kt` special math functions to Boost, Copyright Eric Ford & Hubert Holin 2001. The [Boost Software License 1.0](app/src/main/assets/open-source/Kotlin-Boost-1.0.txt) is included. It also attributes collection code to GWT, (C) 2007-08 Google Inc., and JVM unsigned-number utilities to Guava's UnsignedLongs, (C) 2011 The Guava Authors; those portions use Apache 2.0. Kotlin compiler-only and JavaScript/WebAssembly-only third-party libraries are not included in this APK.

## Public Suffix List source availability

OkHttp includes a compiled Public Suffix List, governed by the [Mozilla Public License 2.0](app/src/main/assets/open-source/MPL-2.0.txt). Its [upstream NOTICE](app/src/main/assets/open-source/OkHttp-Public-Suffix-NOTICE.txt) is preserved verbatim. These terms apply to that data, not to ChemInventory's independent MIT-licensed code.

The exact, unmodified [Public Suffix List source](app/src/main/assets/open-source/public_suffix_list.dat) used by this release is included alongside these notices and inside the APK. It was obtained from [OkHttp 4.12.0's tagged source distribution](https://github.com/square/okhttp/blob/parent-4.12.0/okhttp/src/test/resources/okhttp3/internal/publicsuffix/public_suffix_list.dat); all 9,507 rules were compared with the data in the published OkHttp 4.12.0 JAR and matched. The current upstream project and list are available at [publicsuffix.org](https://publicsuffix.org/list/). Recipients can use and modify the included source under MPL 2.0.

## Resolved release dependencies

All coordinates below use Apache 2.0 as their primary project license, with the embedded-component terms and attributions above also retained.

```text
androidx.activity:activity-compose:1.8.2
androidx.activity:activity-ktx:1.8.2
androidx.activity:activity:1.8.2
androidx.annotation:annotation-experimental:1.4.1
androidx.annotation:annotation-jvm:1.8.1
androidx.appcompat:appcompat-resources:1.1.0
androidx.appcompat:appcompat:1.1.0
androidx.arch.core:core-common:2.2.0
androidx.arch.core:core-runtime:2.2.0
androidx.autofill:autofill:1.0.0
androidx.camera:camera-camera2:1.4.2
androidx.camera:camera-core:1.4.2
androidx.camera:camera-lifecycle:1.4.2
androidx.camera:camera-video:1.4.2
androidx.camera:camera-view:1.4.2
androidx.collection:collection-jvm:1.4.0
androidx.collection:collection-ktx:1.4.0
androidx.compose.animation:animation-android:1.7.0
androidx.compose.animation:animation-core-android:1.7.0
androidx.compose.foundation:foundation-android:1.7.0
androidx.compose.foundation:foundation-layout-android:1.7.0
androidx.compose.material:material-icons-core-android:1.7.0
androidx.compose.material:material-ripple-android:1.7.0
androidx.compose.material3:material3-android:1.3.0
androidx.compose.runtime:runtime-android:1.7.0
androidx.compose.runtime:runtime-saveable-android:1.7.0
androidx.compose.ui:ui-android:1.7.0
androidx.compose.ui:ui-geometry-android:1.7.0
androidx.compose.ui:ui-graphics-android:1.7.0
androidx.compose.ui:ui-text-android:1.7.0
androidx.compose.ui:ui-tooling-preview-android:1.7.0
androidx.compose.ui:ui-unit-android:1.7.0
androidx.compose.ui:ui-util-android:1.7.0
androidx.concurrent:concurrent-futures-ktx:1.1.0
androidx.concurrent:concurrent-futures:1.1.0
androidx.core:core-ktx:1.13.1
androidx.core:core:1.13.1
androidx.cursoradapter:cursoradapter:1.0.0
androidx.customview:customview-poolingcontainer:1.0.0
androidx.customview:customview:1.0.0
androidx.drawerlayout:drawerlayout:1.0.0
androidx.emoji2:emoji2:1.3.0
androidx.exifinterface:exifinterface:1.4.2
androidx.fragment:fragment:1.1.0
androidx.graphics:graphics-path:1.0.1
androidx.interpolator:interpolator:1.0.0
androidx.lifecycle:lifecycle-common-java8:2.8.3
androidx.lifecycle:lifecycle-common-jvm:2.8.3
androidx.lifecycle:lifecycle-livedata-core-ktx:2.8.3
androidx.lifecycle:lifecycle-livedata-core:2.8.3
androidx.lifecycle:lifecycle-livedata:2.8.3
androidx.lifecycle:lifecycle-process:2.8.3
androidx.lifecycle:lifecycle-runtime-android:2.8.3
androidx.lifecycle:lifecycle-runtime-compose-android:2.8.3
androidx.lifecycle:lifecycle-runtime-ktx-android:2.8.3
androidx.lifecycle:lifecycle-viewmodel-android:2.8.3
androidx.lifecycle:lifecycle-viewmodel-ktx:2.8.3
androidx.lifecycle:lifecycle-viewmodel-savedstate:2.8.3
androidx.lifecycle:lifecycle-viewmodel:2.8.3
androidx.loader:loader:1.0.0
androidx.profileinstaller:profileinstaller:1.3.1
androidx.savedstate:savedstate-ktx:1.2.1
androidx.savedstate:savedstate:1.2.1
androidx.startup:startup-runtime:1.1.1
androidx.tracing:tracing-ktx:1.2.0
androidx.tracing:tracing:1.2.0
androidx.vectordrawable:vectordrawable-animated:1.1.0
androidx.vectordrawable:vectordrawable:1.1.0
androidx.versionedparcelable:versionedparcelable:1.1.1
androidx.viewpager:viewpager:1.0.0
com.google.auto.value:auto-value-annotations:1.6.3
com.google.guava:listenablefuture:1.0
com.squareup.okhttp3:okhttp:4.12.0
com.squareup.okio:okio-jvm:3.6.0
org.jetbrains:annotations:23.0.0
org.jetbrains.kotlin:kotlin-stdlib-jdk7:1.9.10
org.jetbrains.kotlin:kotlin-stdlib-jdk8:1.9.10
org.jetbrains.kotlin:kotlin-stdlib:2.0.21
org.jetbrains.kotlinx:kotlinx-coroutines-android:1.7.3
org.jetbrains.kotlinx:kotlinx-coroutines-core-jvm:1.7.3
org.jspecify:jspecify:1.0.0
```

## Maintaining these notices

When updating runtime dependencies, resolve `./gradlew :app:dependencies --configuration releaseRuntimeClasspath`, inspect the resulting AAR/JAR archives (including nested JARs) for `LICENSE`, `NOTICE`, and native components, and check upstream license inventories for incorporated code and data. Update this document and its copy in `app/src/main/assets/open-source/THIRD_PARTY_NOTICES.md` together. Keep the referenced license/source files in APK assets. These notices describe the release contents; they are not a claim of endorsement by any upstream project.
