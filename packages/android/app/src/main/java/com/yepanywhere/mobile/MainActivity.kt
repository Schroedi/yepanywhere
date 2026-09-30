package com.yepanywhere.mobile

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.viewModels
import androidx.core.net.toUri
import androidx.lifecycle.lifecycleScope
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.setValue
import androidx.compose.runtime.mutableStateOf
import com.yepanywhere.mobile.links.AppLinkDestination
import com.yepanywhere.mobile.ui.YaHostManagementScreen
import com.yepanywhere.mobile.ui.YaHostManagementViewModel
import com.yepanywhere.mobile.ui.YaPairingInput
import com.yepanywhere.mobile.ui.theme.YepAnywhereTheme
import com.yepanywhere.mobile.web.WebClientActivity
import com.yepanywhere.mobile.web.WebClientConfig
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.Job

class MainActivity : ComponentActivity() {
    private val homeViewModel by viewModels<YaHostManagementViewModel>()
    private var launchJob: Job? = null
    // App Link credentials are transient visible UI state, never a ViewModel
    // value or saved-instance state.
    private var pairingInput by mutableStateOf<YaPairingInput?>(null)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            YepAnywhereTheme {
                LaunchedEffect(homeViewModel) {
                    homeViewModel.openProfile.collect { pairingInput = null; startWebClient(null, it) }
                }
                YaHostManagementScreen(
                    viewModel = homeViewModel,
                    pairingInput = pairingInput,
                    onClearPairingInput = { pairingInput = null },
                )
            }
        }
        if (savedInstanceState == null) {
            routeLaunch(intent)
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        routeLaunch(intent)
    }

    private fun routeLaunch(intent: Intent) {
        launchJob?.cancel()
        if (intent.getBooleanExtra(SHOW_HOSTS, false)) return
        if (WebClientConfig.fromBuild().bundled) {
            val pairingLink = AppLinkDestination.toNativePairingLink(intent.action, intent.dataString)
            if (pairingLink != null) {
                intent.data = null
                pairingInput = YaPairingInput(pairingLink.username, pairingLink.password, relayWebsocketUrl = pairingLink.relayWebsocketUrl)
                return
            }
            // A malformed pairing link must never fall through to web login.
            if (intent.action == Intent.ACTION_VIEW && intent.data != null) {
                intent.data = null
                return
            }
        }
        val requestedUrl = AppLinkDestination.toWebClientUrlForIntent(
            action = intent.action,
            appLink = intent.dataString,
            clientStartUrl = WebClientConfig.fromBuild().startUrl,
        )
        intent.data = null
        launchJob = lifecycleScope.launch {
            val list = (application as YepAnywhereApplication).nativeRuntime.pairedServers.listState.first()
            val profileId = list.selectedProfileId ?: list.profiles.firstOrNull()?.id
            if (profileId != null) startWebClient(requestedUrl, profileId)
            else if (!WebClientConfig.fromBuild().bundled && requestedUrl != null) startWebClient(requestedUrl, null)
        }
    }

    private fun startWebClient(requestedUrl: String?, profileId: String?) {
        startActivity(
            Intent(this, WebClientActivity::class.java).apply {
                putExtra(WebClientActivity.PROFILE_ID, profileId)
                if (requestedUrl != null) {
                    data = requestedUrl.toUri()
                }
            },
        )
    }

    companion object { const val SHOW_HOSTS = "showHosts" }
}
