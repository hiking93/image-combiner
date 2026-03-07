// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    if image_combiner_lib::try_encode_subprocess() {
        return;
    }
    image_combiner_lib::run()
}
